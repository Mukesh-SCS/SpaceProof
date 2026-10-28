"use client";

import { useRef, useState } from "react";

export interface NormBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Handle = "nw" | "ne" | "sw" | "se";
type Drag =
  | { kind: "draw"; x: number; y: number }
  | { kind: "move"; box: NormBox; x: number; y: number }
  | { kind: "resize"; handle: Handle; box: NormBox };

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pointFromEvent(event: React.PointerEvent, surface: HTMLElement): { x: number; y: number } {
  const rect = surface.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1)),
    y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1)),
  };
}

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): NormBox | null {
  const box = {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
  if (box.maxX - box.minX < 0.02 || box.maxY - box.minY < 0.02) return null;
  return box;
}

function moveBox(box: NormBox, dx: number, dy: number): NormBox {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const minX = clamp(box.minX + dx);
  const minY = clamp(box.minY + dy);
  return {
    minX: Math.min(minX, 1 - width),
    minY: Math.min(minY, 1 - height),
    maxX: Math.min(minX, 1 - width) + width,
    maxY: Math.min(minY, 1 - height) + height,
  };
}

function resizeBox(box: NormBox, handle: Handle, point: { x: number; y: number }): NormBox | null {
  const next = { ...box };
  if (handle === "nw" || handle === "sw") next.minX = point.x;
  if (handle === "ne" || handle === "se") next.maxX = point.x;
  if (handle === "nw" || handle === "ne") next.minY = point.y;
  if (handle === "sw" || handle === "se") next.maxY = point.y;
  return normalize({ x: next.minX, y: next.minY }, { x: next.maxX, y: next.maxY });
}

export function PlacementEditor({
  imageUrl,
  box,
  obstacles,
  drawing,
  onDrawingChange,
  onBoxChange,
}: {
  imageUrl: string | null;
  box: NormBox | null;
  obstacles: NormBox[];
  drawing: boolean;
  onDrawingChange: (drawing: boolean) => void;
  onBoxChange: (box: NormBox) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [live, setLive] = useState<NormBox | null>(null);
  const shown = live ?? box;

  function update(next: NormBox | null) {
    setLive(next);
    if (next) onBoxChange(next);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageUrl || !surfaceRef.current) return;
    const handle = (event.target as HTMLElement).dataset.handle as Handle | undefined;
    const point = pointFromEvent(event, surfaceRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (handle && shown) {
      dragRef.current = { kind: "resize", handle, box: shown };
      return;
    }
    const onRegion = Boolean((event.target as HTMLElement).closest("[data-region='placement']"));
    if (shown && onRegion && !drawing) {
      dragRef.current = { kind: "move", box: shown, x: point.x, y: point.y };
      return;
    }
    if (!drawing && shown) return;
    dragRef.current = { kind: "draw", x: point.x, y: point.y };
    onDrawingChange(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !surfaceRef.current) return;
    const point = pointFromEvent(event, surfaceRef.current);
    if (drag.kind === "draw") {
      setLive(normalize({ x: drag.x, y: drag.y }, point));
      return;
    }
    if (drag.kind === "move") {
      setLive(moveBox(drag.box, point.x - drag.x, point.y - drag.y));
      return;
    }
    setLive(resizeBox(drag.box, drag.handle, point));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (live) onBoxChange(live);
    setLive(null);
    if (drag?.kind === "draw") onDrawingChange(false);
  }

  function nudge(dx: number, dy: number) {
    if (!shown) return;
    onBoxChange(moveBox(shown, dx, dy));
  }

  return (
    <div className="space-y-3">
      <div
        ref={surfaceRef}
        className="relative overflow-hidden rounded-xl bg-ink/5"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Uploaded room" className="block h-auto w-full select-none" draggable={false} />
        ) : (
          <div className="flex min-h-56 items-center justify-center px-6 text-center text-base text-ink/70">
            Upload a room photo to propose a desk area. The photo will not be measured.
          </div>
        )}
        {imageUrl
          ? obstacles.map((obstacle, index) => (
              <div
                key={`obstacle-${index}`}
                className="pointer-events-none absolute border border-dashed border-nofit/80"
                style={{
                  left: `${obstacle.minX * 100}%`,
                  top: `${obstacle.minY * 100}%`,
                  width: `${(obstacle.maxX - obstacle.minX) * 100}%`,
                  height: `${(obstacle.maxY - obstacle.minY) * 100}%`,
                }}
              />
            ))
          : null}
        {imageUrl && shown ? (
          <div
            data-region="placement"
            role="slider"
            aria-label="Desk placement region"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(shown.minX * 100)}
            tabIndex={0}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.05 : 0.01;
              if (event.key === "ArrowLeft") nudge(-step, 0);
              if (event.key === "ArrowRight") nudge(step, 0);
              if (event.key === "ArrowUp") nudge(0, -step);
              if (event.key === "ArrowDown") nudge(0, step);
            }}
            className="absolute cursor-move border-2 border-teal bg-teal/20"
            style={{
              left: `${shown.minX * 100}%`,
              top: `${shown.minY * 100}%`,
              width: `${(shown.maxX - shown.minX) * 100}%`,
              height: `${(shown.maxY - shown.minY) * 100}%`,
            }}
          >
            {(["nw", "ne", "sw", "se"] as const).map((handle) => (
              <button
                key={handle}
                type="button"
                data-handle={handle}
                aria-label={`Resize ${handle}`}
                className={`absolute h-7 w-7 ${handle.includes("n") ? "-top-3" : "-bottom-3"} ${handle.includes("w") ? "-left-3" : "-right-3"}`}
              >
                <span className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-card bg-teal" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p className="text-sm leading-6 text-ink/70">
        The teal rectangle is a placement proposal. Drag it, resize the corners, or draw a new one. Arrow keys nudge the
        selected rectangle. It does not measure the room.
      </p>
    </div>
  );
}
