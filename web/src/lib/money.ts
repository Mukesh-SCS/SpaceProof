const USD_MINOR_DIGITS = 2;

export function minorToPayPalValue(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error("Amount must be a non-negative integer in minor units.");
  }
  const whole = Math.trunc(minor / 100);
  const fraction = minor % 100;
  return `${whole}.${fraction.toString().padStart(USD_MINOR_DIGITS, "0")}`;
}

export function payPalValueToMinor(value: string): number | null {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number(match[2]);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

export function formatUsd(minor: number): string {
  return `$${minorToPayPalValue(minor)}`;
}

/** Parses a dollar input such as "180" or "180.50" into cents. Rejects fractions past two digits. */
export function parseUsdToMinor(input: string): number | null {
  const trimmed = input.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = Number(match[1]);
  const fractionText = (match[2] ?? "").padEnd(2, "0");
  const fraction = Number(fractionText);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}
