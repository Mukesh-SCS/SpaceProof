import { Prisma } from "@prisma/client";
import { readAssessmentRequest } from "@/lib/assessments";
import { prisma } from "@/lib/db/prisma";
import { assessFit, type CatalogProduct, type NormalizedRoom } from "@/lib/geometry/fit";
import type { AssessmentResponse } from "@/lib/api-types";
import { evidenceFingerprint, type EvidenceRoom } from "@/lib/policy/fingerprint";
import { roomDraftChanged } from "@/lib/rooms";
import { placementChanged, placementColumns, placementFromRow, type PlacementBox } from "@/lib/scene";

function toCatalog(product: {
  sku: string;
  title: string;
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

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }

  const parsed = readAssessmentRequest(payload);
  if (!parsed.ok) {
    return Response.json({ message: parsed.message }, { status: 400 });
  }

  const productRow = await prisma.product.findUnique({ where: { sku: parsed.sku } });
  const product = productRow ? toCatalog(productRow) : null;
  const decision = assessFit(product, parsed.room);

  let assessmentId: string | null = null;
  let roomId: string | null = null;
  let measurementVersion: number | null = null;
  let policyFingerprint: string | null = null;

  if (productRow && product && decision.normalizedRoom) {
    const draft = decision.normalizedRoom;
    const saved = await prisma.$transaction(async (tx) => {
      let room;
      if (parsed.roomId) {
        const existing = await tx.roomMeasurement.findUnique({ where: { id: parsed.roomId } });
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
        const nextPlacement = parsed.placementPresent ? parsed.placement : currentPlacement;
        const sceneChanged = parsed.placementPresent && placementChanged(currentPlacement, parsed.placement);
        if (roomDraftChanged(current, draft) || sceneChanged) {
          const updated = await tx.roomMeasurement.updateMany({
            where: { id: existing.id, version: existing.version },
            data: {
              ...draftData(draft),
              ...(parsed.placementPresent ? placementColumns(nextPlacement) : {}),
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) return { conflict: true as const };
          room = await tx.roomMeasurement.findUniqueOrThrow({ where: { id: existing.id } });
        } else if (parsed.placementPresent && labelOnly(currentPlacement, parsed.placement)) {
          await tx.roomMeasurement.update({
            where: { id: existing.id },
            data: placementColumns(parsed.placement),
          });
          room = await tx.roomMeasurement.findUniqueOrThrow({ where: { id: existing.id } });
        } else {
          room = existing;
        }
      } else {
        room = await tx.roomMeasurement.create({
          data: {
            ...draftData(draft),
            ...(parsed.placementPresent ? placementColumns(parsed.placement) : {}),
            version: 1,
          },
        });
      }

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
      };
    });

    if ("missingRoom" in saved) {
      return Response.json({ message: "That room measurement does not exist." }, { status: 404 });
    }
    if ("conflict" in saved) {
      return Response.json({ message: "The room changed while it was being saved. Check the fit again." }, { status: 409 });
    }
    assessmentId = saved.assessmentId;
    roomId = saved.roomId;
    measurementVersion = saved.measurementVersion;
    policyFingerprint = saved.policyFingerprint;
  }

  const body: AssessmentResponse = {
    assessmentId,
    roomId,
    measurementVersion,
    policyFingerprint,
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

  return Response.json(body, {
    status: product ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
