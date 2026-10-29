export interface NormBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type EditorTool = "move" | "resize" | "draw";
export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export interface DragSession {
  kind: "draw" | "move" | "resize";
  origin: { x: number; y: number };
  box: NormBox | null;
  handle?: ResizeHandle;
}

const MIN_SPAN = 0.02;

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeBox(a: { x: number; y: number }, b: { x: number; y: number }): NormBox | null {
  const box = {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
  if (box.maxX - box.minX < MIN_SPAN || box.maxY - box.minY < MIN_SPAN) return null;
  return box;
}

export function moveBox(box: NormBox, dx: number, dy: number): NormBox {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const minX = Math.min(clampUnit(box.minX + dx), 1 - width);
  const minY = Math.min(clampUnit(box.minY + dy), 1 - height);
  return { minX, minY, maxX: minX + width, maxY: minY + height };
}

export function resizeBox(box: NormBox, handle: ResizeHandle, point: { x: number; y: number }): NormBox | null {
  const next = { ...box };
  if (handle === "nw" || handle === "sw") next.minX = point.x;
  if (handle === "ne" || handle === "se") next.maxX = point.x;
  if (handle === "nw" || handle === "ne") next.minY = point.y;
  if (handle === "sw" || handle === "se") next.maxY = point.y;
  return normalizeBox({ x: next.minX, y: next.minY }, { x: next.maxX, y: next.maxY });
}

/**
 * The image element is sized to the bitmap. This maps a pointer on that element to 0–1 image fractions.
 * It does not use the letterboxed container, so object-contain bars cannot shift the rectangle.
 */
export function pointOnImage(
  clientX: number,
  clientY: number,
  image: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: clampUnit((clientX - image.left) / Math.max(image.width, 1)),
    y: clampUnit((clientY - image.top) / Math.max(image.height, 1)),
  };
}

export function startDrag(input: {
  tool: EditorTool;
  box: NormBox | null;
  point: { x: number; y: number };
  handle: ResizeHandle | null;
  onRegion: boolean;
}): DragSession | null {
  if (input.tool === "draw" || !input.box) {
    return { kind: "draw", origin: input.point, box: input.box };
  }
  if (input.handle && input.box) {
    return { kind: "resize", origin: input.point, box: input.box, handle: input.handle };
  }
  if (input.onRegion) {
    return { kind: "move", origin: input.point, box: input.box };
  }
  return null;
}

export function dragTo(session: DragSession, point: { x: number; y: number }): NormBox | null {
  if (session.kind === "draw") return normalizeBox(session.origin, point);
  if (!session.box) return null;
  if (session.kind === "move") {
    return moveBox(session.box, point.x - session.origin.x, point.y - session.origin.y);
  }
  if (!session.handle) return null;
  return resizeBox(session.box, session.handle, point);
}

export function finishDrag(
  session: DragSession | null,
  live: NormBox | null,
  reason: "up" | "cancel",
): { commit: NormBox | null; tool: EditorTool | null } {
  if (!session || reason === "cancel") return { commit: null, tool: null };
  if (session.kind === "draw") return { commit: live, tool: live ? "move" : null };
  return { commit: live, tool: null };
}

/** An uncalibrated photograph has no centimeter mapping. Callers must not invent one. */
export function centimetersFromPlacement(_box: NormBox | null): null {
  return null;
}
