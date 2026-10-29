/** Display conversions. Fit checks keep the stored millimeter value until a person edits a field. */
export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

export interface LengthFields {
  /** Canonical millimeters. Null means the buyer has not entered this length. */
  mm: number | null;
  feet: string;
  inches: string;
}

export interface ClearanceFields {
  mm: number | null;
  inches: string;
}

function parseImperialNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatInches(inches: number): string {
  return inches.toFixed(2).replace(/\.?0+$/, "") || "0";
}

/** Display split only. Callers must not write this back over a stored millimeter value. */
export function splitMillimeters(mm: number): { feet: number; inches: number } {
  const totalInches = mm / MM_PER_INCH;
  const feet = Math.floor(totalInches / 12 + 1e-9);
  let inches = Math.round((totalInches - feet * 12) * 100) / 100;
  if (inches >= 12) return { feet: feet + 1, inches: 0 };
  return { feet, inches };
}

export function lengthFieldsFromMillimeters(mm: number | null): LengthFields {
  if (mm === null || !Number.isFinite(mm)) return { mm: null, feet: "", inches: "" };
  const parts = splitMillimeters(mm);
  return { mm, feet: String(parts.feet), inches: formatInches(parts.inches) };
}

export function clearanceFieldsFromMillimeters(mm: number | null): ClearanceFields {
  if (mm === null || !Number.isFinite(mm)) return { mm: null, inches: "" };
  return { mm, inches: formatInches(Math.round((mm / MM_PER_INCH) * 100) / 100) };
}

/** Integer millimeters for a buyer-entered feet and inches pair. One rounding, at this boundary. */
export function millimetersFromFeetAndInches(feetText: string, inchesText: string): number | null {
  const feetBlank = feetText.trim() === "";
  const inchesBlank = inchesText.trim() === "";
  if (feetBlank && inchesBlank) return null;
  const feet = feetBlank ? 0 : parseImperialNumber(feetText);
  const inches = inchesBlank ? 0 : parseImperialNumber(inchesText);
  if (feet === null || inches === null) return null;
  const rounded = Math.round(feet * MM_PER_FOOT + inches * MM_PER_INCH);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}

export function millimetersFromInches(text: string): number | null {
  if (text.trim() === "") return null;
  const inches = parseImperialNumber(text);
  if (inches === null) return null;
  const rounded = Math.round(inches * MM_PER_INCH);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}

/**
 * Keep the stored millimeters when the field text is still the loaded display.
 * A different feet or inches value becomes the new measurement.
 */
export function editLength(current: LengthFields, patch: { feet?: string; inches?: string }): LengthFields {
  const feet = patch.feet ?? current.feet;
  const inches = patch.inches ?? current.inches;
  if (current.mm !== null) {
    const shown = lengthFieldsFromMillimeters(current.mm);
    if (feet === shown.feet && inches === shown.inches) return { mm: current.mm, feet, inches };
  }
  return { mm: millimetersFromFeetAndInches(feet, inches), feet, inches };
}

export function editClearance(current: ClearanceFields, inches: string): ClearanceFields {
  if (current.mm !== null && inches === clearanceFieldsFromMillimeters(current.mm).inches) {
    return { mm: current.mm, inches };
  }
  return { mm: millimetersFromInches(inches), inches };
}

export function lengthLabel(millimeters: number | null): string {
  if (millimeters === null || !Number.isFinite(millimeters)) return "Not available";
  const parts = splitMillimeters(millimeters);
  const inchText = `${formatInches(parts.inches)} in`;
  if (parts.feet === 0) return inchText;
  if (parts.inches === 0) return `${parts.feet} ft`;
  return `${parts.feet} ft ${inchText}`;
}

export function inchesLabel(millimeters: number | null): string {
  if (millimeters === null || !Number.isFinite(millimeters)) return "Not available";
  return `${formatInches(Math.round((millimeters / MM_PER_INCH) * 100) / 100)} in`;
}
