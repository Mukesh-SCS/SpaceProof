import { createHash } from "node:crypto";
import type { CatalogProduct, FitResult } from "@/lib/geometry/fit";

/** Authoritative room row used to decide whether an assessment is still current. */
export interface EvidenceRoom {
  id: string;
  availableWidthMm: number;
  availableDepthMm: number;
  requiredHorizontalClearanceMm: number;
  requiredDepthClearanceMm: number;
  budgetMinor: number;
  currency: string;
  confirmed: boolean;
  version: number;
}

/**
 * Stable digest of the constraints that were actually checked.
 * A changed measurement, catalog dimension, price, or result produces a different digest.
 */
export function evidenceFingerprint(input: {
  product: CatalogProduct;
  room: EvidenceRoom;
  result: FitResult;
}): string {
  const fields: Record<string, string | number | boolean> = {
    available: input.product.available,
    availableDepthMm: input.room.availableDepthMm,
    availableWidthMm: input.room.availableWidthMm,
    budgetMinor: input.room.budgetMinor,
    confirmed: input.room.confirmed,
    currency: input.product.currency,
    depthMm: input.product.depthMm,
    heightMm: input.product.heightMm,
    measurementVersion: input.room.version,
    priceMinor: input.product.priceMinor,
    requiredDepthClearanceMm: input.room.requiredDepthClearanceMm,
    requiredHorizontalClearanceMm: input.room.requiredHorizontalClearanceMm,
    result: input.result,
    roomCurrency: input.room.currency,
    roomId: input.room.id,
    sku: input.product.sku,
    widthMm: input.product.widthMm,
  };
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${String(fields[key])}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
