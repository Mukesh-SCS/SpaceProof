import type { NormalizedRoom } from "@/lib/geometry/fit";

export function roomDraftChanged(current: NormalizedRoom, next: NormalizedRoom): boolean {
  return (
    current.availableWidthMm !== next.availableWidthMm ||
    current.availableDepthMm !== next.availableDepthMm ||
    current.requiredHorizontalClearanceMm !== next.requiredHorizontalClearanceMm ||
    current.requiredDepthClearanceMm !== next.requiredDepthClearanceMm ||
    current.budgetMinor !== next.budgetMinor ||
    current.currency !== next.currency ||
    current.confirmed !== next.confirmed
  );
}
