"use client";

import { useEffect, useRef, useState } from "react";
import {
  dragTo,
  finishDrag,
  pointOnImage,
  startDrag,
  type DragSession,
  type EditorTool,
  type NormBox,
  type ResizeHandle,
} from "@/lib/placement-session";

export type { NormBox };

const HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];

export function PlacementEditor({
  imageUrl,
  box,
  aiBox,
  obstacles,
  tool,
  status,
  regionLabel,
  onToolChange,
  onBoxChange,
  onClear,
  onReset,
  onConfirmArea,
  onSuggest,
  suggesting,
}: {
  imageUrl: string | null;
  box: NormBox | null;
  aiBox?: NormBox | null;
  obstacles: NormBox[];
  tool: EditorTool;
  status: string;
  regionLabel?: string;
  onToolChange: (tool: EditorTool) => void;
  onBoxChange: (box: NormBox) => void;
  onClear: () => void;
  onReset: () => void;
  onConfirmArea: () => void;
  onSuggest: () => void;
  suggesting?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const liveRef = useRef<NormBox | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const [live, setLive] = useState<NormBox | null>(null);
  const [imageFrame, setImageFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const shown = live ?? box;

  useEffect(() => {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image || !frame) return;
    const measure = () => {
      const imageRect = image.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      setImageFrame({
        left: imageRect.left - frameRect.left,
        top: imageRect.top - frameRect.top,
        width: imageRect.width,
        height: imageRect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    observer.observe(frame);
    image.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      image.removeEventListener("load", measure);
    };
  }, [imageUrl]);

  function remember(next: NormBox | null) {
    liveRef.current = next;
    setLive(next);
  }

  function endDrag(reason: "up" | "cancel") {
    stopTracking.current?.();
    stopTracking.current = null;
    if (!dragRef.current) return;
    const finished = finishDrag(dragRef.current, liveRef.current, reason);
    dragRef.current = null;
    liveRef.current = null;
    setLive(null);
    if (finished.commit) onBoxChange(finished.commit);
    if (finished.tool) onToolChange(finished.tool);
  }

  useEffect(() => () => stopTracking.current?.(), []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageUrl || imageFrame.width < 2) return;
    const imageRect = {
      left: event.currentTarget.getBoundingClientRect().left,
      top: event.currentTarget.getBoundingClientRect().top,
      width: event.currentTarget.clientWidth,
      height: event.currentTarget.clientHeight,
    };
    const handleElement = (event.target as HTMLElement).closest("[data-handle]");
    const handle = (handleElement?.getAttribute("data-handle") as ResizeHandle | null) ?? null;
    const point = pointOnImage(event.clientX, event.clientY, imageRect);
    const session = startDrag({
      tool,
      box: shown,
      point,
      handle,
      onRegion: Boolean((event.target as HTMLElement).closest("[data-region='placement']")),
    });
    if (!session) return;
    event.preventDefault();
    dragRef.current = session;
    const pointerId = event.pointerId;
    const surface = event.currentTarget;
    const move = (native: PointerEvent) => {
      const active = dragRef.current;
      if (!active || native.pointerId !== pointerId) return;
      const rect = surface.getBoundingClientRect();
      remember(dragTo(active, pointOnImage(native.clientX, native.clientY, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })));
    };
    const finish = (native: PointerEvent, reason: "up" | "cancel") => {
      if (native.pointerId !== pointerId) return;
      endDrag(reason);
    };
    const up = (native: PointerEvent) => finish(native, "up");
    const cancel = (native: PointerEvent) => finish(native, "cancel");
    stopTracking.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    try {
      surface.setPointerCapture(pointerId);
    } catch {
      // Synthetic and cancelled pointers have no active id. Window listeners still end the drag.
    }
  }

  function nudge(dx: number, dy: number, resize: boolean) {
    if (!shown) return;
    if (resize) {
      const next = {
        minX: shown.minX,
        minY: shown.minY,
        maxX: Math.min(1, Math.max(shown.minX + 0.04, shown.maxX + dx)),
        maxY: Math.min(1, Math.max(shown.minY + 0.04, shown.maxY + dy)),
      };
      onBoxChange(next);
      return;
    }
    const width = shown.maxX - shown.minX;
    const height = shown.maxY - shown.minY;
    const minX = Math.min(Math.max(0, shown.minX + dx), 1 - width);
    const minY = Math.min(Math.max(0, shown.minY + dy), 1 - height);
    onBoxChange({ minX, minY, maxX: minX + width, maxY: minY + height });
  }

  const drawing = tool === "draw";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Placement tools">
        <ToolButton label="Let AI suggest" pressed={false} disabled={suggesting} onClick={onSuggest} testId="action-suggest" />
        <ToolButton label="Draw your space" pressed={tool === "draw"} onClick={() => onToolChange("draw")} testId="tool-draw" />
        <ToolButton label="Move" pressed={tool === "move"} onClick={() => onToolChange("move")} testId="tool-move" />
        <ToolButton label="Resize" pressed={tool === "resize"} onClick={() => onToolChange("resize")} testId="tool-resize" />
        <ToolButton label="Reset to AI suggestion" pressed={false} disabled={!aiBox} onClick={onReset} testId="action-reset" />
        <ToolButton label="Clear selection" pressed={false} disabled={!box && !live} onClick={onClear} testId="action-clear" />
        <ToolButton label="Confirm area" pressed={false} disabled={!box} onClick={onConfirmArea} testId="action-confirm-area" />
      </div>
      <p className="text-sm font-medium text-teal" data-testid="placement-status">
        {suggesting ? "Looking for a placement area. No measurement is being inferred." : status}
      </p>
      <div ref={frameRef} className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-xl bg-ink/5 sm:min-h-[28rem]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Uploaded room"
            className="block h-auto max-h-[36rem] w-auto max-w-full select-none"
            draggable={false}
          />
        ) : (
          <div className="px-6 text-center text-base leading-7 text-ink/70">
            Upload a room photo to propose a placement area. The photo will not be measured.
          </div>
        )}
        {imageUrl && imageFrame.width > 2 ? (
          <div
            data-testid="placement-surface"
            className={`absolute touch-none ${drawing ? "cursor-crosshair" : "cursor-default"}`}
            style={{ left: imageFrame.left, top: imageFrame.top, width: imageFrame.width, height: imageFrame.height }}
            onPointerDown={onPointerDown}
            onLostPointerCapture={() => {
              if (!dragRef.current) return;
              endDrag("up");
            }}
          >
            {obstacles.map((obstacle, index) => (
              <div
                key={`obstacle-${index}`}
                className="pointer-events-none absolute border border-dashed border-nofit/80"
                style={boxStyle(obstacle)}
              />
            ))}
            {shown ? (
              <div
                data-region="placement"
                data-testid="placement-region"
                role="slider"
                aria-label="Placement region"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(shown.minX * 100)}
                tabIndex={0}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.05 : 0.01;
                  const resize = tool === "resize";
                  if (event.key === "ArrowLeft") nudge(resize ? -step : -step, resize ? 0 : 0, resize);
                  if (event.key === "ArrowRight") nudge(step, 0, resize);
                  if (event.key === "ArrowUp") nudge(0, -step, resize);
                  if (event.key === "ArrowDown") nudge(0, step, resize);
                }}
                className={`absolute border-2 ${drawing ? "pointer-events-none border-dashed border-ink bg-ink/10" : "cursor-move border-teal bg-teal/25"}`}
                style={boxStyle(shown)}
              >
                <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-card/95 px-2 py-0.5 text-[11px] font-medium text-teal">
                  {drawing ? "New area" : (regionLabel ?? status)}
                </span>
                {HANDLES.map((handle) => (
                  <div
                    key={handle}
                    role="button"
                    tabIndex={-1}
                    data-handle={handle}
                    data-testid={`handle-${handle}`}
                    aria-label={`Resize ${handle}`}
                    className={`absolute h-11 w-11 ${drawing ? "pointer-events-none" : ""} ${handle.includes("n") ? "-top-5" : "-bottom-5"} ${handle.includes("w") ? "-left-5" : "-right-5"}`}
                  >
                    <span className="pointer-events-none absolute top-1/2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-card bg-teal" />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="text-sm leading-6 text-ink/70">
        {drawing
          ? "Drag on the photo to replace the selection. The photograph does not supply feet or inches."
          : "Drag inside the area to move it. Use the corner handles, or Resize, to change it. Arrow keys nudge the selection."}
      </p>
    </div>
  );
}

function boxStyle(box: NormBox): { left: string; top: string; width: string; height: string } {
  return {
    left: `${box.minX * 100}%`,
    top: `${box.minY * 100}%`,
    width: `${(box.maxX - box.minX) * 100}%`,
    height: `${(box.maxY - box.minY) * 100}%`,
  };
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      disabled={disabled}
      className={`min-h-11 rounded-full border px-3 text-sm disabled:opacity-50 ${
        pressed ? "border-teal bg-teal text-white" : "border-line bg-card"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
