import { describe, expect, it } from "vitest";
import {
  MM_PER_FOOT,
  MM_PER_INCH,
  clearanceFieldsFromMillimeters,
  editClearance,
  editLength,
  inchesLabel,
  lengthFieldsFromMillimeters,
  lengthLabel,
  millimetersFromFeetAndInches,
  millimetersFromInches,
} from "@/lib/imperial";
import { sceneSignature, type SceneInputs } from "@/lib/scene-freshness";

describe("feet and inches", () => {
  it("uses 25.4 mm per inch and 304.8 mm per foot", () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(MM_PER_FOOT).toBe(304.8);
    expect(millimetersFromInches("1")).toBe(25);
    expect(millimetersFromFeetAndInches("1", "0")).toBe(305);
    expect(millimetersFromFeetAndInches("5", "6")).toBe(1676);
  });

  it("shows a stored length without replacing it", () => {
    const loaded = lengthFieldsFromMillimeters(1500);
    expect(loaded).toEqual({ mm: 1500, feet: "4", inches: "11.06" });
    expect(editLength(loaded, { feet: loaded.feet, inches: loaded.inches }).mm).toBe(1500);
    expect(clearanceFieldsFromMillimeters(200)).toEqual({ mm: 200, inches: "7.87" });
    expect(editClearance(clearanceFieldsFromMillimeters(200), "7.87").mm).toBe(200);
  });

  it("turns a real edit into new millimeters and a new scene", () => {
    const loaded = lengthFieldsFromMillimeters(1500);
    const edited = editLength(loaded, { inches: "0" });
    expect(edited.mm).toBe(1219);
    const scene: SceneInputs = {
      imageToken: "photo-a",
      widthMm: 1500,
      depthMm: 1200,
      sideClearanceMm: 200,
      depthClearanceMm: 200,
      budget: "180",
      confirmed: true,
      placement: null,
      constraintEpoch: 1,
    };
    expect(sceneSignature({ ...scene, widthMm: edited.mm })).not.toBe(sceneSignature(scene));
  });

  it("labels furniture in feet and inches and clearance in inches", () => {
    expect(lengthLabel(1000)).toBe("3 ft 3.37 in");
    expect(lengthLabel(1524)).toBe("5 ft");
    expect(inchesLabel(200)).toBe("7.87 in");
    expect(lengthLabel(null)).toBe("Not available");
  });
});
