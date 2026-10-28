import type { RoomConstraints } from "@/lib/geometry/fit";
import { readPlacement, type PlacementBox } from "@/lib/scene";

export function readAssessmentRequest(body: unknown):
  | {
      ok: true;
      sku: string;
      roomId: string | null;
      room: RoomConstraints;
      placementPresent: boolean;
      placement: PlacementBox | null;
    }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Expected a JSON object." };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.sku !== "string" || !/^[A-Z0-9-]{1,40}$/.test(record.sku)) {
    return { ok: false, message: "A catalog SKU is required." };
  }
  if (record.roomId !== undefined && record.roomId !== null && typeof record.roomId !== "string") {
    return { ok: false, message: "Room id must be a string." };
  }
  const roomId = typeof record.roomId === "string" && record.roomId.trim() !== "" ? record.roomId.trim() : null;
  const placement = readPlacement(record.placement);
  if (!placement.ok) return placement;

  return {
    ok: true,
    sku: record.sku,
    roomId,
    placementPresent: placement.present,
    placement: placement.placement,
    room: {
      availableWidthMm: record.availableWidthMm ?? null,
      availableDepthMm: record.availableDepthMm ?? null,
      requiredHorizontalClearanceMm: record.requiredHorizontalClearanceMm ?? null,
      requiredDepthClearanceMm: record.requiredDepthClearanceMm ?? null,
      budgetMinor: record.budgetMinor ?? null,
      currency: record.currency ?? null,
      confirmed: record.confirmed ?? null,
    },
  };
}

export function readRoomPatch(body: unknown):
  | { ok: true; room: RoomConstraints; placementPresent: boolean; placement: PlacementBox | null }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Expected a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const placement = readPlacement(record.placement);
  if (!placement.ok) return placement;
  return {
    ok: true,
    placementPresent: placement.present,
    placement: placement.placement,
    room: {
      availableWidthMm: record.availableWidthMm ?? null,
      availableDepthMm: record.availableDepthMm ?? null,
      requiredHorizontalClearanceMm: record.requiredHorizontalClearanceMm ?? null,
      requiredDepthClearanceMm: record.requiredDepthClearanceMm ?? null,
      budgetMinor: record.budgetMinor ?? null,
      currency: record.currency ?? null,
      confirmed: record.confirmed ?? null,
    },
  };
}
