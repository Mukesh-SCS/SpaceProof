import { lengthLabel } from "@/lib/imperial";
import type { FitResult } from "@/lib/geometry/fit";
import type { PlacementBox } from "@/lib/scene";

/** Inputs that must match before a stored assessment can open checkout. */
export interface SceneInputs {
  imageToken: string;
  /** Canonical millimeters. Display text is not part of the signature. */
  widthMm: number | null;
  depthMm: number | null;
  sideClearanceMm: number | null;
  depthClearanceMm: number | null;
  budget: string;
  confirmed: boolean;
  placement: PlacementBox | null;
  /** Bumped when the server room version changes without a form edit. */
  constraintEpoch: number;
}

export interface AssessmentStamp {
  sceneSignature: string;
  roomId: string;
  measurementVersion: number;
  policyFingerprint: string;
  sku: string;
  priceMinor: number;
  result: FitResult;
}

export function sceneSignature(scene: SceneInputs): string {
  const placement = scene.placement
    ? {
        minX: scene.placement.minX,
        minY: scene.placement.minY,
        maxX: scene.placement.maxX,
        maxY: scene.placement.maxY,
      }
    : null;
  return JSON.stringify({
    imageToken: scene.imageToken,
    widthMm: scene.widthMm,
    depthMm: scene.depthMm,
    sideClearanceMm: scene.sideClearanceMm,
    depthClearanceMm: scene.depthClearanceMm,
    budget: scene.budget,
    confirmed: scene.confirmed,
    placement,
    constraintEpoch: scene.constraintEpoch,
  });
}

export function assessmentIsCurrent(stamp: AssessmentStamp | null | undefined, signature: string): boolean {
  return Boolean(stamp && stamp.sceneSignature === signature && stamp.roomId && stamp.policyFingerprint);
}

/**
 * Local checkout gate. The server still revalidates before authorize or capture.
 * A stamp from another photograph, placement, measurement, price, or SKU cannot pass.
 */
export function checkoutMayOpen(input: {
  stamp: AssessmentStamp | null | undefined;
  signature: string;
  catalogSku: string;
  catalogPriceMinor: number;
  consent: boolean;
}): boolean {
  if (!input.consent || !assessmentIsCurrent(input.stamp, input.signature)) return false;
  const stamp = input.stamp;
  if (!stamp) return false;
  return stamp.result === "FIT" && stamp.sku === input.catalogSku && stamp.priceMinor === input.catalogPriceMinor;
}

export function confirmationStatement(widthMm: number | null, depthMm: number | null): string {
  const width = widthMm === null ? "?" : lengthLabel(widthMm);
  const depth = depthMm === null ? "?" : lengthLabel(depthMm);
  return `This selected area has ${width} usable width and ${depth} usable depth.`;
}

/** A new photograph requires a new confirmation. Completed payments stay in the ledger. */
export function sceneReplacement(): { confirmed: false; consent: false } {
  return { confirmed: false, consent: false };
}

export function retainPaymentHistory<T>(payments: Record<string, T | null>): Record<string, T | null> {
  return { ...payments };
}

/** Every stored assessment in one batch must share one room version. */
export function versionsAreConsistent(versions: Array<number | null | undefined>): boolean {
  const present = versions.filter((version): version is number => typeof version === "number");
  return new Set(present).size <= 1;
}
