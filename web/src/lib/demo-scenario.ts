/** Prefilled demo corner. The fit decision still comes from the server. */
export const DEMO_ROOM = {
  availableWidthMm: 1500,
  availableDepthMm: 1200,
  requiredHorizontalClearanceMm: 200,
  requiredDepthClearanceMm: 200,
  budgetMinor: 18000,
  currency: "USD",
  confirmed: true,
} as const;

/** Scenario A: a 100 cm room against the 140 cm studio desk. */
export const SCENARIO_A_WIDTH_MM = 1000;

/** Scenario B: a 150 cm room against the 100 cm nook desk. */
export const SCENARIO_B_WIDTH_MM = 1500;
