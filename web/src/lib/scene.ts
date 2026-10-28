/** A rectangle on the photograph. Coordinates are fractions of the image, not millimeters. */
export interface PlacementBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  label: string;
  source: "ai" | "buyer";
}

export interface StoredPlacement {
  placementMinX: number | null;
  placementMinY: number | null;
  placementMaxX: number | null;
  placementMaxY: number | null;
  placementLabel: string | null;
  placementSource: string | null;
}

export function readPlacement(
  value: unknown,
): { ok: true; present: boolean; placement: PlacementBox | null } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, present: false, placement: null };
  if (value === null) return { ok: true, present: true, placement: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "The placement region must be an object." };
  }
  const record = value as Record<string, unknown>;
  const coords: number[] = [];
  for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
    const number = record[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) {
      return { ok: false, message: "Placement coordinates must be numbers from 0 to 1." };
    }
    coords.push(Math.round(number * 10000) / 10000);
  }
  const [minX, minY, maxX, maxY] = coords;
  if (maxX - minX < 0.01 || maxY - minY < 0.01) {
    return { ok: false, message: "The placement region is too small." };
  }
  if (record.source !== "ai" && record.source !== "buyer") {
    return { ok: false, message: "Placement source must be ai or buyer." };
  }
  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim().slice(0, 80)
      : "Desk placement area";
  return {
    ok: true,
    present: true,
    placement: { minX, minY, maxX, maxY, label, source: record.source },
  };
}

export function placementFromRow(row: StoredPlacement): PlacementBox | null {
  if (
    row.placementMinX === null ||
    row.placementMinY === null ||
    row.placementMaxX === null ||
    row.placementMaxY === null
  ) {
    return null;
  }
  const source = row.placementSource === "ai" || row.placementSource === "buyer" ? row.placementSource : "buyer";
  return {
    minX: row.placementMinX,
    minY: row.placementMinY,
    maxX: row.placementMaxX,
    maxY: row.placementMaxY,
    label: row.placementLabel ?? "Desk placement area",
    source,
  };
}

export function placementColumns(box: PlacementBox | null): StoredPlacement {
  if (!box) {
    return {
      placementMinX: null,
      placementMinY: null,
      placementMaxX: null,
      placementMaxY: null,
      placementLabel: null,
      placementSource: null,
    };
  }
  return {
    placementMinX: box.minX,
    placementMinY: box.minY,
    placementMaxX: box.maxX,
    placementMaxY: box.maxY,
    placementLabel: box.label,
    placementSource: box.source,
  };
}

/** Coordinate changes invalidate an assessment. The label alone does not. */
export function placementChanged(current: PlacementBox | null, next: PlacementBox | null): boolean {
  if (!current && !next) return false;
  if (!current || !next) return true;
  return (
    current.minX !== next.minX ||
    current.minY !== next.minY ||
    current.maxX !== next.maxX ||
    current.maxY !== next.maxY
  );
}
