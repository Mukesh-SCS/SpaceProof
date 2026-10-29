import { readRoomPatch } from "@/lib/assessments";
import { recordCatalogAssessments } from "@/lib/record-assessment";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ message: "Expected a JSON object." }, { status: 400 });
  }
  const record = payload as Record<string, unknown>;
  const parsed = readRoomPatch(payload);
  if (!parsed.ok) {
    return Response.json({ message: parsed.message }, { status: 400 });
  }
  const roomId = typeof record.roomId === "string" && record.roomId.trim() !== "" ? record.roomId.trim() : null;
  const skus = Array.isArray(record.skus)
    ? record.skus.filter((sku): sku is string => typeof sku === "string" && /^[A-Z0-9-]{1,40}$/.test(sku))
    : undefined;
  if (Array.isArray(record.skus) && (!skus || skus.length !== record.skus.length)) {
    return Response.json({ message: "Each SKU must use letters, numbers, and hyphens." }, { status: 400 });
  }

  const saved = await recordCatalogAssessments({
    roomId,
    room: parsed.room,
    placementPresent: parsed.placementPresent,
    placement: parsed.placement,
    skus,
  });
  if ("missingRoom" in saved) {
    return Response.json({ message: "That room measurement does not exist." }, { status: 404 });
  }
  if ("conflict" in saved) {
    return Response.json({ message: "The room changed while it was being saved. Check the fit again." }, { status: 409 });
  }
  const versions = saved.assessments.map((item) => item.measurementVersion);
  const distinct = new Set(versions.filter((version): version is number => typeof version === "number"));
  if (distinct.size > 1) {
    return Response.json({ message: "The catalog check did not share one room version." }, { status: 409 });
  }
  return Response.json(
    {
      roomId: saved.assessments.find((item) => item.roomId)?.roomId ?? roomId,
      measurementVersion: saved.assessments.find((item) => item.measurementVersion !== null)?.measurementVersion ?? null,
      assessments: saved.assessments,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
