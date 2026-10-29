export const FIT_RESULTS = ["FIT", "DOES_NOT_FIT", "UNCERTAIN"] as const;
export type FitResult = (typeof FIT_RESULTS)[number];

const MAX_DIMENSION_MM = 100_000;
const MAX_MONEY_MINOR = 100_000_000;
const SUPPORTED_CURRENCY = "USD";

export type ProductCategory = "desk" | "dining_table";

export interface CatalogProduct {
  sku: string;
  title: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  priceMinor: number;
  currency: string;
  available: boolean;
  /** Omitted rows are desks. The server catalog is the source of this value. */
  category?: ProductCategory;
}

export interface RoomConstraints {
  availableWidthMm: unknown;
  availableDepthMm: unknown;
  requiredHorizontalClearanceMm: unknown;
  requiredDepthClearanceMm: unknown;
  budgetMinor: unknown;
  currency: unknown;
  confirmed: unknown;
}

export interface FitReason {
  code: string;
  message: string;
  blocking: boolean;
  facts?: Record<string, number | string>;
}

export interface NormalizedRoom {
  availableWidthMm: number;
  availableDepthMm: number;
  requiredHorizontalClearanceMm: number;
  requiredDepthClearanceMm: number;
  budgetMinor: number;
  currency: string;
  confirmed: boolean;
}

export interface FitAssessmentResult {
  result: FitResult;
  reasons: FitReason[];
  explanation: string;
  requiredWidthMm: number | null;
  requiredDepthMm: number | null;
  availableWidthMm: number | null;
  availableDepthMm: number | null;
  requiredHorizontalClearanceMm: number | null;
  requiredDepthClearanceMm: number | null;
  budgetMinor: number | null;
  priceMinor: number | null;
  currency: string | null;
  normalizedRoom: NormalizedRoom | null;
}

type ParsedInt = { ok: true; value: number } | { ok: false; problem: "missing" | "invalid" };

function reason(
  code: string,
  message: string,
  blocking: boolean,
  facts?: Record<string, number | string>,
): FitReason {
  return facts ? { code, message, blocking, facts } : { code, message, blocking };
}

export function explainAssessment(reasons: FitReason[]): string {
  if (reasons.length === 0) return "No fit reasons were recorded.";
  return reasons.map((item) => item.message).join(" ");
}

function parseIntInRange(value: unknown, min: number, max: number): ParsedInt {
  if (value === null || value === undefined) return { ok: false, problem: "missing" };
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    return { ok: false, problem: "invalid" };
  }
  if (value < min || value > max) return { ok: false, problem: "invalid" };
  return { ok: true, value };
}

function parseCurrency(value: unknown): { ok: true; value: string } | { ok: false; problem: "missing" | "invalid" } {
  if (value === null || value === undefined || value === "") return { ok: false, problem: "missing" };
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return { ok: false, problem: "invalid" };
  return { ok: true, value };
}

function emptyComparison(overrides: Partial<FitAssessmentResult> = {}): FitAssessmentResult {
  const reasons = overrides.reasons ?? [];
  return {
    result: "UNCERTAIN",
    requiredWidthMm: null,
    requiredDepthMm: null,
    availableWidthMm: null,
    availableDepthMm: null,
    requiredHorizontalClearanceMm: null,
    requiredDepthClearanceMm: null,
    budgetMinor: null,
    priceMinor: null,
    currency: null,
    normalizedRoom: null,
    ...overrides,
    reasons,
    explanation: explainAssessment(reasons),
  };
}

function dimensionIssue(label: string, code: string, parsed: ParsedInt, allowZero: boolean): FitReason | null {
  if (parsed.ok) return null;
  if (parsed.problem === "missing") {
    return reason(
      `${code}_MISSING`,
      `${label} was not provided. SpaceProof will not guess a measurement.`,
      false,
    );
  }
  return reason(
    `${code}_INVALID`,
    `${label} must be a whole number of millimeters${allowZero ? ", zero or greater" : ", greater than zero"}.`,
    false,
  );
}

/**
 * Pure fit check. Photos, model output, and browser prices are not inputs.
 * Horizontal clearance is added to width. Depth clearance is added to depth.
 * The desk is not rotated. A fit is the constraints that were checked, not a physical guarantee.
 */
export function assessFit(product: CatalogProduct | null, room: RoomConstraints): FitAssessmentResult {
  const uncertain: FitReason[] = [];

  const width = parseIntInRange(room.availableWidthMm, 1, MAX_DIMENSION_MM);
  const depth = parseIntInRange(room.availableDepthMm, 1, MAX_DIMENSION_MM);
  const horizontal = parseIntInRange(room.requiredHorizontalClearanceMm, 0, MAX_DIMENSION_MM);
  const depthClearance = parseIntInRange(room.requiredDepthClearanceMm, 0, MAX_DIMENSION_MM);
  const budget = parseIntInRange(room.budgetMinor, 0, MAX_MONEY_MINOR);
  const currency = parseCurrency(room.currency);

  const widthIssue = dimensionIssue("Room width", "WIDTH", width, false);
  const depthIssue = dimensionIssue("Room depth", "DEPTH", depth, false);
  const horizontalIssue = dimensionIssue("Required side clearance", "HORIZONTAL_CLEARANCE", horizontal, true);
  const depthClearanceIssue = dimensionIssue("Required depth clearance", "DEPTH_CLEARANCE", depthClearance, true);
  if (widthIssue) uncertain.push(widthIssue);
  if (depthIssue) uncertain.push(depthIssue);
  if (horizontalIssue) uncertain.push(horizontalIssue);
  if (depthClearanceIssue) uncertain.push(depthClearanceIssue);

  if (!budget.ok) {
    uncertain.push(
      budget.problem === "missing"
        ? reason("BUDGET_MISSING", "A maximum budget was not provided.", false)
        : reason("BUDGET_INVALID", "Maximum budget must be a whole number of cents, zero or more.", false),
    );
  }

  if (!currency.ok) {
    uncertain.push(
      currency.problem === "missing"
        ? reason("CURRENCY_MISSING", "Budget currency was not provided.", false)
        : reason("CURRENCY_INVALID", "Budget currency must be a three-letter code such as USD.", false),
    );
  } else if (currency.value !== SUPPORTED_CURRENCY) {
    uncertain.push(
      reason(
        "CURRENCY_UNSUPPORTED",
        `Only ${SUPPORTED_CURRENCY} prices can be compared. No conversion was applied.`,
        false,
        { currency: currency.value },
      ),
    );
  }

  if (room.confirmed !== true) {
    uncertain.push(
      reason(
        "MEASUREMENT_UNCONFIRMED",
        "Measurements must be confirmed before an item can be marked as a fit.",
        false,
      ),
    );
  }

  let catalog: {
    sku: string;
    widthMm: number;
    depthMm: number;
    priceMinor: number;
    currency: string;
    available: boolean;
  } | null = null;

  if (!product) {
    uncertain.push(reason("CATALOG_MISSING", "That product is not in the trusted catalog.", false));
  } else {
    const productWidth = parseIntInRange(product.widthMm, 1, MAX_DIMENSION_MM);
    const productDepth = parseIntInRange(product.depthMm, 1, MAX_DIMENSION_MM);
    const productPrice = parseIntInRange(product.priceMinor, 0, MAX_MONEY_MINOR);
    const productCurrency = parseCurrency(product.currency);
    const skuOk = typeof product.sku === "string" && product.sku.trim().length > 0;
    const availableOk = typeof product.available === "boolean";

    if (
      !skuOk ||
      !productWidth.ok ||
      !productDepth.ok ||
      !productPrice.ok ||
      !productCurrency.ok ||
      productCurrency.value !== SUPPORTED_CURRENCY ||
      !availableOk
    ) {
      uncertain.push(
        reason(
          "CATALOG_INVALID",
          "The catalog row is missing a usable SKU, millimeter size, USD price, or availability flag.",
          false,
        ),
      );
    } else {
      catalog = {
        sku: product.sku,
        widthMm: productWidth.value,
        depthMm: productDepth.value,
        priceMinor: productPrice.value,
        currency: productCurrency.value,
        available: product.available,
      };
    }
  }

  const normalizedRoom =
    width.ok && depth.ok && horizontal.ok && depthClearance.ok && budget.ok && currency.ok
      ? {
          availableWidthMm: width.value,
          availableDepthMm: depth.value,
          requiredHorizontalClearanceMm: horizontal.value,
          requiredDepthClearanceMm: depthClearance.value,
          budgetMinor: budget.value,
          currency: currency.value,
          confirmed: room.confirmed === true,
        }
      : null;

  if (
    uncertain.length > 0 ||
    !width.ok ||
    !depth.ok ||
    !horizontal.ok ||
    !depthClearance.ok ||
    !budget.ok ||
    !currency.ok ||
    currency.value !== SUPPORTED_CURRENCY ||
    !catalog
  ) {
    return emptyComparison({
      result: "UNCERTAIN",
      reasons: uncertain,
      availableWidthMm: width.ok ? width.value : null,
      availableDepthMm: depth.ok ? depth.value : null,
      requiredHorizontalClearanceMm: horizontal.ok ? horizontal.value : null,
      requiredDepthClearanceMm: depthClearance.ok ? depthClearance.value : null,
      budgetMinor: budget.ok ? budget.value : null,
      priceMinor: catalog?.priceMinor ?? null,
      currency: catalog?.currency ?? (currency.ok ? currency.value : null),
      normalizedRoom,
    });
  }

  const piece = product?.category === "dining_table" ? "table" : "desk";
  const sideName = product?.category === "dining_table" ? "chair clearance" : "side clearance";
  const depthName = product?.category === "dining_table" ? "chair clearance" : "depth clearance";

  if (product?.category === "dining_table" && horizontal.value === 0 && depthClearance.value === 0) {
    return emptyComparison({
      result: "UNCERTAIN",
      reasons: [
        reason(
          "CHAIR_CLEARANCE_REQUIRED",
          "A dining table needs buyer-specified chair clearance on the side or the depth. Zero on both is not enough evidence. Doorway and delivery are not checked.",
          false,
        ),
      ],
      availableWidthMm: width.value,
      availableDepthMm: depth.value,
      requiredHorizontalClearanceMm: horizontal.value,
      requiredDepthClearanceMm: depthClearance.value,
      budgetMinor: budget.value,
      priceMinor: catalog.priceMinor,
      currency: catalog.currency,
      normalizedRoom,
    });
  }

  const requiredWidth = catalog.widthMm + horizontal.value;
  const requiredDepth = catalog.depthMm + depthClearance.value;
  if (!Number.isSafeInteger(requiredWidth) || !Number.isSafeInteger(requiredDepth)) {
    return emptyComparison({
      result: "UNCERTAIN",
      reasons: [reason("DIMENSION_OVERFLOW", "The required size could not be calculated safely.", false)],
    });
  }

  const violations: FitReason[] = [];

  if (!catalog.available) {
    violations.push(
      reason("UNAVAILABLE", `${catalog.sku} is not available in the catalog.`, true, { sku: catalog.sku }),
    );
  }

  if (catalog.widthMm > width.value) {
    violations.push(
      reason(
        "WIDTH_EXCEEDS_ROOM",
        `The ${piece} is ${catalog.widthMm} mm wide and the room is only ${width.value} mm wide.`,
        true,
        { productWidthMm: catalog.widthMm, roomWidthMm: width.value },
      ),
    );
  } else if (requiredWidth > width.value) {
    violations.push(
      reason(
        "CLEARANCE_EXCEEDS_WIDTH",
        `The ${piece} is ${catalog.widthMm} mm wide, and ${horizontal.value} mm of ${sideName} raises the required width to ${requiredWidth} mm, which is more than the ${width.value} mm available.`,
        true,
        {
          requiredWidthMm: requiredWidth,
          roomWidthMm: width.value,
          clearanceMm: horizontal.value,
        },
      ),
    );
  }

  if (catalog.depthMm > depth.value) {
    violations.push(
      reason(
        "DEPTH_EXCEEDS_ROOM",
        `The ${piece} is ${catalog.depthMm} mm deep and the room is only ${depth.value} mm deep.`,
        true,
        { productDepthMm: catalog.depthMm, roomDepthMm: depth.value },
      ),
    );
  } else if (requiredDepth > depth.value) {
    violations.push(
      reason(
        "CLEARANCE_EXCEEDS_DEPTH",
        `The ${piece} is ${catalog.depthMm} mm deep, and ${depthClearance.value} mm of ${depthName} raises the required depth to ${requiredDepth} mm, which is more than the ${depth.value} mm available.`,
        true,
        {
          requiredDepthMm: requiredDepth,
          roomDepthMm: depth.value,
          clearanceMm: depthClearance.value,
        },
      ),
    );
  }

  if (catalog.priceMinor > budget.value) {
    violations.push(
      reason(
        "OVER_BUDGET",
        `The catalog price is ${catalog.priceMinor} cents ${catalog.currency}, which is above the maximum budget of ${budget.value} cents.`,
        true,
        { priceMinor: catalog.priceMinor, budgetMinor: budget.value, currency: catalog.currency },
      ),
    );
  }

  const comparison = {
    requiredWidthMm: requiredWidth,
    requiredDepthMm: requiredDepth,
    availableWidthMm: width.value,
    availableDepthMm: depth.value,
    requiredHorizontalClearanceMm: horizontal.value,
    requiredDepthClearanceMm: depthClearance.value,
    budgetMinor: budget.value,
    priceMinor: catalog.priceMinor,
    currency: catalog.currency,
    normalizedRoom,
  };

  if (violations.length > 0) {
    return emptyComparison({
      result: "DOES_NOT_FIT",
      reasons: violations,
      ...comparison,
    });
  }

  return emptyComparison({
    result: "FIT",
    reasons: [
      reason(
        "FIT_WIDTH",
        `Required width ${requiredWidth} mm is within the ${width.value} mm room, including ${horizontal.value} mm of ${sideName}.`,
        false,
        { requiredWidthMm: requiredWidth, roomWidthMm: width.value },
      ),
      reason(
        "FIT_DEPTH",
        `Required depth ${requiredDepth} mm is within the ${depth.value} mm room, including ${depthClearance.value} mm of ${depthName}.`,
        false,
        { requiredDepthMm: requiredDepth, roomDepthMm: depth.value },
      ),
      reason(
        "FIT_BUDGET",
        `Catalog price ${catalog.priceMinor} cents is within the ${budget.value} cent budget.`,
        false,
        { priceMinor: catalog.priceMinor, budgetMinor: budget.value },
      ),
      reason(
        "FIT_AVAILABLE",
        `${catalog.sku} is available in the catalog.`,
        false,
        { sku: catalog.sku },
      ),
    ],
    ...comparison,
  });
}
