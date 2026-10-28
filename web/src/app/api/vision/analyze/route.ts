import { visionServiceUrl } from "@/lib/vision/proxy";

export async function POST(request: Request) {
  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return Response.json({ message: "Upload a JPEG or PNG photograph." }, { status: 400 });
  }
  const file = incoming.get("image");
  if (!(file instanceof File)) {
    return Response.json({ message: "Choose a JPEG or PNG photograph." }, { status: 400 });
  }
  const outbound = new FormData();
  outbound.set("image", file, file.name || "room.jpg");
  try {
    const response = await fetch(`${visionServiceUrl()}/analyze-room`, {
      method: "POST",
      body: outbound,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ message: "The vision service returned an unreadable response." }));
    return Response.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { code: "VISION_UNAVAILABLE", message: "The vision service is not running on port 8000." },
      { status: 503 },
    );
  }
}
