import { describe, expect, it } from "vitest";
import {
  centimetersFromPlacement,
  dragTo,
  finishDrag,
  moveBox,
  pointOnImage,
  resizeBox,
  startDrag,
} from "@/lib/placement-session";
import { measurementsForImage, provenanceLabel } from "@/lib/measurement-provenance";

const ai = { minX: 0.1, minY: 0.2, maxX: 0.4, maxY: 0.6 };

describe("placement drawing", () => {
  it("lets a new drag replace an existing rectangle", () => {
    const session = startDrag({
      tool: "draw",
      box: ai,
      point: { x: 0.5, y: 0.5 },
      handle: null,
      onRegion: true,
    });
    expect(session?.kind).toBe("draw");
    const overHandle = startDrag({
      tool: "draw",
      box: ai,
      point: { x: 0.4, y: 0.6 },
      handle: "se",
      onRegion: true,
    });
    expect(overHandle?.kind).toBe("draw");
    const live = session ? dragTo(session, { x: 0.8, y: 0.9 }) : null;
    expect(live?.minX).toBeCloseTo(0.5);
    expect(finishDrag(session, live, "up").commit?.maxX).toBeCloseTo(0.8);
    expect(finishDrag(session, live, "up").tool).toBe("move");
  });

  it("can redraw more than once", () => {
    let box = ai;
    for (const origin of [0.2, 0.45]) {
      const session = startDrag({
        tool: "draw",
        box,
        point: { x: origin, y: 0.2 },
        handle: null,
        onRegion: false,
      });
      const live = session ? dragTo(session, { x: origin + 0.3, y: 0.7 }) : null;
      const finished = finishDrag(session, live, "up");
      expect(finished.commit).not.toBeNull();
      box = finished.commit!;
    }
    expect(box.minX).toBeCloseTo(0.45);
  });

  it("resizes from a handle and moves from inside the region", () => {
    const resized = resizeBox(ai, "se", { x: 0.7, y: 0.85 });
    expect(resized?.maxX).toBeCloseTo(0.7);
    expect(resized?.maxY).toBeCloseTo(0.85);
    const moved = moveBox(ai, 0.1, 0);
    expect(moved.minX).toBeCloseTo(0.2);
    expect(moved.maxX - moved.minX).toBeCloseTo(ai.maxX - ai.minX);
  });

  it("does not commit a rectangle when the pointer is cancelled", () => {
    const session = startDrag({
      tool: "draw",
      box: ai,
      point: { x: 0.1, y: 0.1 },
      handle: null,
      onRegion: false,
    });
    const live = session ? dragTo(session, { x: 0.6, y: 0.6 }) : null;
    expect(finishDrag(session, live, "cancel")).toEqual({ commit: null, tool: null });
  });

  it("maps pointers onto the image, not the surrounding frame", () => {
    const point = pointOnImage(150, 80, { left: 100, top: 40, width: 200, height: 100 });
    expect(point).toEqual({ x: 0.25, y: 0.4 });
  });

  it("never turns a placement rectangle into centimeters", () => {
    expect(centimetersFromPlacement(ai)).toBeNull();
    expect(measurementsForImage("photo").widthMm).toBeNull();
    expect(measurementsForImage("photo").provenance).toBe("not_measured");
    expect(provenanceLabel("demo_preset")).toMatch(/not measured from photo/i);
    expect(measurementsForImage("sample").widthMm).toBe(1500);
  });
});
