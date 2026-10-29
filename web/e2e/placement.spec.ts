import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const sample = path.resolve(__dirname, "../public/samples/room-01-corner.jpg");

const suggestion = {
  room_description: "A corner with open floor.",
  placement_candidates: [
    {
      id: "region-1",
      label: "Desk placement area",
      bbox_normalized: [0.1, 0.2, 0.45, 0.7],
      confidence: 0.7,
      reason: "Open floor.",
    },
  ],
  visible_obstacles: [],
  measurement_questions: [],
  warnings: ["The photo has no scale."],
  dimensions_mm: null,
  requires_user_confirmation: true,
};

async function mockSuggestion(page: Page) {
  await page.route("**/api/vision/analyze", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(suggestion) });
  });
}

async function upload(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(sample);
  await expect(page.getByTestId("placement-region")).toBeVisible();
}

async function dragOnSurface(page: Page, surface: ReturnType<Page["getByTestId"]>, x0: number, y0: number, x1: number, y1: number) {
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error("The placement surface is not visible.");
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function regionLeftFraction(page: Page) {
  const surface = page.getByTestId("placement-surface");
  const region = page.getByTestId("placement-region");
  const surfaceBox = await surface.boundingBox();
  const regionBox = await region.boundingBox();
  if (!surfaceBox || !regionBox) throw new Error("The placement surface is not visible.");
  return (regionBox.x - surfaceBox.x) / surfaceBox.width;
}

test("draws, redraws, resizes, moves, clears, and restores an AI suggestion", async ({ page }) => {
  await mockSuggestion(page);
  await upload(page);
  await expect(page.getByText("AI suggested")).toBeVisible();
  await expect(page.getByTestId("placement-status")).toHaveText("Measurements needed");
  await expect(page.getByTestId("measurement-provenance")).toHaveText("Not measured");
  await expect(page.locator("#room-width-ft")).toHaveValue("");
  await expect(page.locator("#room-width-in")).toHaveValue("");

  await page.getByTestId("tool-draw").click();
  const surface = page.getByTestId("placement-surface");
  await dragOnSurface(page, surface, 0.5, 0.2, 0.9, 0.85);
  expect(await regionLeftFraction(page)).toBeGreaterThan(0.35);

  await page.getByTestId("tool-draw").click();
  await expect(page.getByTestId("tool-draw")).toHaveAttribute("aria-pressed", "true");
  await dragOnSurface(page, surface, 0.15, 0.15, 0.55, 0.7);
  const redrawn = await regionLeftFraction(page);
  expect(redrawn).toBeLessThan(0.3);

  const beforeResize = await page.getByTestId("placement-region").boundingBox();
  const handle = page.getByTestId("handle-se");
  const handleBox = await handle.boundingBox();
  if (!beforeResize || !handleBox) throw new Error("The resize handle is not visible.");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 80, handleBox.y + 60, { steps: 6 });
  await page.mouse.up();
  const afterResize = await page.getByTestId("placement-region").boundingBox();
  expect(afterResize && beforeResize && afterResize.width).not.toBe(beforeResize.width);

  const beforeMove = await regionLeftFraction(page);
  const region = await page.getByTestId("placement-region").boundingBox();
  if (!region) throw new Error("The region is not visible.");
  await page.getByTestId("tool-move").click();
  await page.mouse.move(region.x + region.width / 2, region.y + region.height / 2);
  await page.mouse.down();
  await page.mouse.move(region.x + region.width / 2 + 48, region.y + region.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await regionLeftFraction(page)).toBeGreaterThan(beforeMove);

  await page.getByTestId("action-clear").click();
  await expect(page.getByTestId("placement-region")).toHaveCount(0);
  await page.getByTestId("action-reset").click();
  await expect(page.getByTestId("placement-region")).toBeVisible();
  expect(await regionLeftFraction(page)).toBeLessThan(0.25);

  const beforeKey = Number(await page.getByTestId("placement-region").getAttribute("aria-valuenow"));
  await page.getByTestId("placement-region").focus();
  await page.keyboard.press("ArrowRight");
  const afterKey = Number(await page.getByTestId("placement-region").getAttribute("aria-valuenow"));
  expect(afterKey).toBeGreaterThan(beforeKey);
});

test("a cancelled pointer does not keep dragging", async ({ page }) => {
  await mockSuggestion(page);
  await upload(page);
  await page.getByTestId("tool-draw").click();
  const surface = page.getByTestId("placement-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("The placement surface is not visible.");
  const before = await regionLeftFraction(page);
  await surface.dispatchEvent("pointerdown", {
    clientX: box.x + box.width * 0.6,
    clientY: box.y + box.height * 0.2,
    pointerId: 1,
    pointerType: "mouse",
    bubbles: true,
  });
  await surface.dispatchEvent("pointermove", {
    clientX: box.x + box.width * 0.9,
    clientY: box.y + box.height * 0.8,
    pointerId: 1,
    pointerType: "mouse",
    bubbles: true,
  });
  await surface.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", bubbles: true });
  await surface.dispatchEvent("pointermove", {
    clientX: box.x + box.width * 0.1,
    clientY: box.y + box.height * 0.1,
    pointerId: 1,
    pointerType: "mouse",
    bubbles: true,
  });
  expect(await regionLeftFraction(page)).toBeCloseTo(before, 1);
});

test("invalid JSON and a late suggestion do not invent a measurement or replace a drawing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
  await page.route("**/api/vision/analyze", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ code: "INVALID_MODEL_OUTPUT", message: "The model returned invalid JSON." }),
    });
  });
  await page.locator("input[type=file]").setInputFiles(sample);
  await expect(page.getByRole("img", { name: "Uploaded room" })).toBeVisible();
  await expect(page.getByTestId("vision-error")).toHaveText("AI suggestion unavailable. You can draw the area manually.");
  await expect(page.locator("#room-width-ft")).toHaveValue("");
  await expect(page.locator("#room-width-in")).toHaveValue("");
  await expect(page.getByTestId("measurement-provenance")).toHaveText("Not measured");

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.unroute("**/api/vision/analyze");
  await page.route("**/api/vision/analyze", async (route: Route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(suggestion) });
  });
  await page.locator("input[type=file]").setInputFiles(sample);
  await expect(page.getByTestId("placement-status")).toHaveText("Looking for a placement area. No measurement is being inferred.");
  await page.getByTestId("tool-draw").click();
  const surface = page.getByTestId("placement-surface");
  await dragOnSurface(page, surface, 0.55, 0.2, 0.9, 0.8);
  const drawn = await regionLeftFraction(page);
  release();
  await page.waitForTimeout(500);
  expect(await regionLeftFraction(page)).toBeCloseTo(drawn, 1);
  await expect(page.locator("#room-width-ft")).toHaveValue("");
  await expect(page.locator("#room-width-in")).toHaveValue("");
});

test("confirmed feet and inches can be checked, and an edit closes PayPal", async ({ page }) => {
  await mockSuggestion(page);
  await upload(page);
  await page.locator("#room-width-ft").fill("4");
  await page.locator("#room-width-in").fill("6");
  await page.locator("#room-depth-ft").fill("3");
  await page.locator("#room-depth-in").fill("0");
  await expect(page.getByTestId("measurement-provenance")).toHaveText("Buyer entered");
  await page.locator("#room-width-in").fill("1");
  await page.getByRole("checkbox", { name: /I confirm these measurements/ }).check();
  await expect(page.getByTestId("measurement-provenance")).toHaveText("Buyer confirmed");
  await page.getByRole("button", { name: "Find what fits" }).click();
  await expect(page.getByText("The confirmed space can hold this item.").first()).toBeVisible();
  await page.locator("article").filter({ hasText: "The confirmed space can hold this item." }).first().getByRole("button", { name: "Select" }).click();
  await expect(page.getByRole("checkbox", { name: /PayPal Sandbox authorization/ })).toBeVisible();
  await page.locator("#room-width-ft").fill("2");
  await page.locator("#room-width-in").fill("0");
  await expect(page.getByText("Check again").first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /PayPal Sandbox authorization/ })).toHaveCount(0);
});

test("a second photograph drops the previous fit result", async ({ page }) => {
  await mockSuggestion(page);
  await upload(page);
  await page.locator("#room-width-ft").fill("5");
  await page.locator("#room-width-in").fill("0");
  await page.locator("#room-depth-ft").fill("4");
  await page.locator("#room-depth-in").fill("0");
  await page.getByRole("checkbox", { name: /I confirm these measurements/ }).check();
  await page.getByRole("button", { name: "Find what fits" }).click();
  await expect(page.getByText("The confirmed space can hold this item.").first()).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(sample);
  await expect(page.locator("#room-width-ft")).toHaveValue("");
  await expect(page.locator("#room-width-in")).toHaveValue("");
  await expect(page.getByText("Check again").first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /PayPal Sandbox authorization/ })).toHaveCount(0);
});

test("the sample room keeps the demo preset instead of measuring the diagram", async ({ page }) => {
  await mockSuggestion(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sample room" }).click();
  await expect(page.getByTestId("measurement-provenance")).toHaveText("Demo preset, not measured from photo");
  await expect(page.locator("#room-width-ft")).toHaveValue("4");
  await expect(page.locator("#room-width-in")).toHaveValue("11.06");
  await expect(page.locator("#room-depth-ft")).toHaveValue("3");
  await expect(page.locator("#room-depth-in")).toHaveValue("11.24");
});

test("touch can draw a replacement area", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile touch test");
  await mockSuggestion(page);
  await upload(page);
  await page.getByTestId("tool-draw").click();
  const surface = page.getByTestId("placement-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("The placement surface is not visible.");
  await surface.dispatchEvent("pointerdown", {
    clientX: box.x + box.width * 0.5,
    clientY: box.y + 20,
    pointerId: 7,
    pointerType: "touch",
    bubbles: true,
  });
  await surface.dispatchEvent("pointermove", {
    clientX: box.x + box.width * 0.85,
    clientY: box.y + box.height * 0.75,
    pointerId: 7,
    pointerType: "touch",
    bubbles: true,
  });
  await surface.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", bubbles: true });
  expect(await regionLeftFraction(page)).toBeGreaterThan(0.3);
});
