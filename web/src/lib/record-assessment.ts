import { Prisma } from "@prisma/client";
import type { AssessmentResponse } from "@/lib/api-types";
import { prisma } from "@/lib/db/prisma";
import { assessFit, type CatalogProduct, type NormalizedRoom, type RoomConstraints } from "@/lib/geometry/fit";
import { evidenceFingerprint, type EvidenceRoom } from "@/lib/policy/fingerprint";
import { roomDraftChanged } from "@/lib/rooms";
import { placementChanged, placementColumns, placementFromRow, type PlacementBox } from "@/lib/scene";

export function toCatalog(product: {
  sku: string;
  title: string;
  category?: "desk" | "dining_table" | null;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  priceMinor: number;
  currency: string;
  available: boolean;
}): CatalogProduct {
  return {
    sku: product.sku,
    title: product.title,
    category: product.category === "dining_table" ? "dining_table" : "desk",
    widthMm: product.widthMm,
    depthMm: product.depthMm,
    heightMm: product.heightMm,
    priceMinor: product.priceMinor,
    currency: product.currency,
    available: product.available,
  };
}

function labelOnly(current: PlacementBox | null, next: PlacementBox | null): boolean {
  if (!current || !next || placementChanged(current, next)) return false;
  return current.label !== next.label || current.source !== next.source;
}

function draftData(draft: NormalizedRoom) {
  return {
    availableWidthMm: draft.availableWidthMm,
    availableDepthMm: draft.availableDepthMm,
    requiredHorizontalClearanceMm: draft.requiredHorizontalClearanceMm,
    requiredDepthClearanceMm: draft.requiredDepthClearanceMm,
    budgetMinor: draft.budgetMinor,
    currency: draft.currency,
    confirmedByUser: draft.confirmed,
  };
}

function evidenceFrom(row: {
  id: string;
  availableWidthMm: number;
  availableDepthMm: number;
  requiredHorizontalClearanceMm: number;
  requiredDepthClearanceMm: number;
  budgetMinor: number;
  currency: string;
  confirmedByUser: boolean;
  version: number;
}): EvidenceRoom {
  return {
    id: row.id,
    availableWidthMm: row.availableWidthMm,
    availableDepthMm: row.availableDepthMm,
    requiredHorizontalClearanceMm: row.requiredHorizontalClearanceMm,
    requiredDepthClearanceMm: row.requiredDepthClearanceMm,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    confirmed: row.confirmedByUser,
    version: row.version,
  };
}

export interface SceneAssessmentInput {
  sku: string;
  roomId: string | null;
  room: RoomConstraints;
  placementPresent: boolean;
  placement: PlacementBox | null;
}

type Saved =
  | { missingRoom: true }
  | { conflict: true }
  | {
      assessmentId: string;
      roomId: string;
      measurementVersion: number;
      policyFingerprint: string;
      createdAt: string;
    };

/**
 * Writes every requested SKU against one room version.
 * A placement or measurement change increments that version once, before the rows are stored.
 */
export async function recordSceneAssessments(input: SceneAssessmentInput): Promise<
  | { missingRoom: true }
  | { conflict: true }
  | { assessment: AssessmentResponse }
> {
  const productRow = await prisma.product.findUnique({ where: { sku: input.sku } });
  const product = productRow ? toCatalog(productRow) : null;
  const decision = assessFit(product, input.room);
  const saved = await persistOne(input, productRow, product, decision);
  if (saved && ("missingRoom" in saved || "conflict" in saved)) return saved;
  return {
    assessment: responseFor(product, decision, saved && "assessmentId" in saved ? saved : null),
  };
}

export async function recordCatalogAssessments(input: Omit<SceneAssessmentInput, "sku"> & { skus?: string[] }): Promise<
  | { missingRoom: true }
  | { conflict: true }
  | { assessments: AssessmentResponse[] }
> {
  const products = await prisma.product.findMany({
    where: input.skus && input.skus.length > 0 ? { sku: { in: input.skus } } : undefined,
    orderBy: { priceMinor: "asc" },
  });
  if (products.length === 0) {
    return { assessments: [] };
  }

  const first = assessFit(toCatalog(products[0]), input.room);
  if (!first.normalizedRoom) {
    return {
      assessments: products.map((row) => {
        const catalog = toCatalog(row);
        const decision = assessFit(catalog, input.room);
        return responseFor(catalog, decision, null);
      }),
    };
  }

  const saved = await prisma.$transaction(async (tx) => {
      const room = await syncRoom(tx, input, first.normalizedRoom!);
      if ("missingRoom" in room || "conflict" in room) return room;
      const evidence = evidenceFrom(room);
      const assessments: AssessmentResponse[] = [];
      for (const row of products) {
        const catalog = toCatalog(row);
        const decision = assessFit(catalog, input.room);
        const fingerprint = evidenceFingerprint({
          product: catalog,
          room: evidence,
          result: decision.result,
        });
        const assessment = await tx.fitAssessment.create({
          data: {
            productId: row.id,
            roomMeasurementId: room.id,
            measurementVersion: room.version,
            result: decision.result,
            reasons: decision.reasons as unknown as Prisma.InputJsonValue,
            explanation: decision.explanation,
            policyFingerprint: fingerprint,
            productWidthMm: row.widthMm,
            productDepthMm: row.depthMm,
            productHeightMm: row.heightMm,
            priceMinor: row.priceMinor,
            currency: row.currency,
            requiredWidthMm: decision.requiredWidthMm,
            requiredDepthMm: decision.requiredDepthMm,
          },
        });
        assessments.push(
          responseFor(catalog, decision, {
            assessmentId: assessment.id,
            roomId: room.id,
            measurementVersion: room.version,
            policyFingerprint: fingerprint,
            createdAt: assessment.createdAt.toISOString(),
          }),
        );
      }
      return { assessments };
    });
  return saved;
}

async function persistOne(
  input: SceneAssessmentInput,
  productRow: Awaited<ReturnType<typeof prisma.product.findFirst>>,
  product: CatalogProduct | null,
  decision: ReturnType<typeof assessFit>,
): Promise<Saved | null> {
  if (!productRow || !product || !decision.normalizedRoom) return null;
  const draft = decision.normalizedRoom;
  const saved = await prisma.$transaction(async (tx) => {
    const room = await syncRoom(tx, input, draft);
    if ("missingRoom" in room || "conflict" in room) return room;
    const evidence = evidenceFrom(room);
    const fingerprint = evidenceFingerprint({
      product,
      room: evidence,
      result: decision.result,
    });
    const assessment = await tx.fitAssessment.create({
      data: {
        productId: productRow.id,
        roomMeasurementId: room.id,
        measurementVersion: room.version,
        result: decision.result,
        reasons: decision.reasons as unknown as Prisma.InputJsonValue,
        explanation: decision.explanation,
        policyFingerprint: fingerprint,
        productWidthMm: productRow.widthMm,
        productDepthMm: productRow.depthMm,
        productHeightMm: productRow.heightMm,
        priceMinor: productRow.priceMinor,
        currency: productRow.currency,
        requiredWidthMm: decision.requiredWidthMm,
        requiredDepthMm: decision.requiredDepthMm,
      },
    });
    return {
      assessmentId: assessment.id,
      roomId: room.id,
      measurementVersion: room.version,
      policyFingerprint: fingerprint,
      createdAt: assessment.createdAt.toISOString(),
    };
  });
  return saved;
}

type Tx = Prisma.TransactionClient;

async function syncRoom(
  tx: Tx,
  input: { roomId: string | null; placementPresent: boolean; placement: PlacementBox | null },
  draft: NormalizedRoom,
) {
  if (input.roomId) {
    const existing = await tx.roomMeasurement.findUnique({ where: { id: input.roomId } });
    if (!existing) return { missingRoom: true as const };
    const current: NormalizedRoom = {
      availableWidthMm: existing.availableWidthMm,
      availableDepthMm: existing.availableDepthMm,
      requiredHorizontalClearanceMm: existing.requiredHorizontalClearanceMm,
      requiredDepthClearanceMm: existing.requiredDepthClearanceMm,
      budgetMinor: existing.budgetMinor,
      currency: existing.currency,
      confirmed: existing.confirmedByUser,
    };
    const currentPlacement = placementFromRow(existing);
    const nextPlacement = input.placementPresent ? input.placement : currentPlacement;
    const sceneChanged = input.placementPresent && placementChanged(currentPlacement, input.placement);
    if (roomDraftChanged(current, draft) || sceneChanged) {
      const updated = await tx.roomMeasurement.updateMany({
        where: { id: existing.id, version: existing.version },
        data: {
          ...draftData(draft),
          ...(input.placementPresent ? placementColumns(nextPlacement) : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return { conflict: true as const };
      return tx.roomMeasurement.findUniqueOrThrow({ where: { id: existing.id } });
    }
    if (input.placementPresent && labelOnly(currentPlacement, input.placement)) {
      await tx.roomMeasurement.update({
        where: { id: existing.id },
        data: placementColumns(input.placement),
      });
      return tx.roomMeasurement.findUniqueOrThrow({ where: { id: existing.id } });
    }
    return existing;
  }
  return tx.roomMeasurement.create({
    data: {
      ...draftData(draft),
      ...(input.placementPresent ? placementColumns(input.placement) : {}),
      version: 1,
    },
  });
}

function responseFor(
  product: CatalogProduct | null,
  decision: ReturnType<typeof assessFit>,
  saved: {
    assessmentId: string;
    roomId: string;
    measurementVersion: number;
    policyFingerprint: string;
    createdAt: string;
  } | null,
): AssessmentResponse {
  return {
    assessmentId: saved?.assessmentId ?? null,
    roomId: saved?.roomId ?? null,
    measurementVersion: saved?.measurementVersion ?? null,
    policyFingerprint: saved?.policyFingerprint ?? null,
    createdAt: saved?.createdAt ?? null,
    result: decision.result,
    reasons: decision.reasons,
    explanation: decision.explanation,
    product,
    comparison: {
      requiredWidthMm: decision.requiredWidthMm,
      requiredDepthMm: decision.requiredDepthMm,
      availableWidthMm: decision.availableWidthMm,
      availableDepthMm: decision.availableDepthMm,
      requiredHorizontalClearanceMm: decision.requiredHorizontalClearanceMm,
      requiredDepthClearanceMm: decision.requiredDepthClearanceMm,
      budgetMinor: decision.budgetMinor,
      priceMinor: decision.priceMinor,
      currency: decision.currency,
    },
  };
}
