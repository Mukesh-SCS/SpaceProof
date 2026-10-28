import { assessFit, type NormalizedRoom } from "@/lib/geometry/fit";
import { readRoomPatch } from "@/lib/assessments";
import { prisma } from "@/lib/db/prisma";
import { roomDraftChanged } from "@/lib/rooms";
import { placementChanged, placementColumns, placementFromRow, type PlacementBox } from "@/lib/scene";

function labelOnly(current: PlacementBox | null, next: PlacementBox | null): boolean {
  if (!current || !next || placementChanged(current, next)) return false;
  return current.label !== next.label || current.source !== next.source;
}

function draftData(draft: NormalizedRoom) {
  return {
    availableWidthMm: draft.availableWidthMm,
    availableDepthMm: draft.availableDepthMm,
    requiredHorizontalClearanceMm: draft.requiredHorizontalClearanceMm,
    requiredDepthClearanceMm: draft.requiredDepthClearanceMm,
    budgetMinor: draft.budgetMinor,
    currency: draft.currency,
    confirmedByUser: draft.confirmed,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  if (!roomId) {
    return Response.json({ message: "A room id is required." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }

  const parsed = readRoomPatch(payload);
  if (!parsed.ok) {
    return Response.json({ message: parsed.message }, { status: 400 });
  }

  const probe = assessFit(null, parsed.room);
  if (!probe.normalizedRoom || probe.normalizedRoom.currency !== "USD") {
    return Response.json(
      { message: probe.explanation || "Room measurements must be whole millimeters and a USD budget." },
      { status: 400 },
    );
  }

  const draft = probe.normalizedRoom;
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.roomMeasurement.findUnique({ where: { id: roomId } });
    if (!existing) return { missing: true as const };
    const current: NormalizedRoom = {
      availableWidthMm: existing.availableWidthMm,
      availableDepthMm: existing.availableDepthMm,
      requiredHorizontalClearanceMm: existing.requiredHorizontalClearanceMm,
      requiredDepthClearanceMm: existing.requiredDepthClearanceMm,
      budgetMinor: existing.budgetMinor,
      currency: existing.currency,
      confirmed: existing.confirmedByUser,
    };
    const currentPlacement = placementFromRow(existing);
    const sceneChanged = parsed.placementPresent && placementChanged(currentPlacement, parsed.placement);
    if (!roomDraftChanged(current, draft) && !sceneChanged) {
      if (parsed.placementPresent && labelOnly(currentPlacement, parsed.placement)) {
        await tx.roomMeasurement.update({
          where: { id: existing.id },
          data: placementColumns(parsed.placement),
        });
      }
      return { id: existing.id, version: existing.version, previousVersion: existing.version, changed: false };
    }
    const updated = await tx.roomMeasurement.updateMany({
      where: { id: existing.id, version: existing.version },
      data: {
        ...draftData(draft),
        ...(parsed.placementPresent ? placementColumns(parsed.placement) : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { conflict: true as const };
    const room = await tx.roomMeasurement.findUniqueOrThrow({ where: { id: existing.id } });
    return { id: room.id, version: room.version, previousVersion: existing.version, changed: true };
  });

  if ("missing" in saved) {
    return Response.json({ message: "That room measurement does not exist." }, { status: 404 });
  }
  if ("conflict" in saved) {
    return Response.json({ message: "The room changed while it was being saved. Try again." }, { status: 409 });
  }

  return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
}
