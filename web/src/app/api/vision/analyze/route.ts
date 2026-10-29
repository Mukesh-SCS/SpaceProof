import { rateLimitedResponse } from "@/lib/rate-limit";
import { rejectDeclaredBody, rejectRoomUpload } from "@/lib/uploads";
import { visionServiceUrl } from "@/lib/vision/proxy";

export async function POST(request: Request) {
  const limited = rateLimitedResponse(request, "vision-analyze", 20);
  if (limited) return limited;
  const declared = rejectDeclaredBody(request.headers.get("content-length"));
  if (declared) return Response.json({ code: "IMAGE_TOO_LARGE", message: declared.message }, { status: declared.status });

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
  const rejected = rejectRoomUpload(file);
  if (rejected) {
    return Response.json(
      { code: rejected.status === 413 ? "IMAGE_TOO_LARGE" : "UNSUPPORTED_IMAGE", message: rejected.message },
      { status: rejected.status },
    );
  }
  const outbound = new FormData();
  outbound.set("image", file, file.name || "room.jpg");
  try {
    const response = await fetch(`${visionServiceUrl()}/analyze-room`, {
      method: "POST",
      body: outbound,
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    const payload = await response.json().catch(() => ({ message: "The vision service returned an unreadable response." }));
    return Response.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { code: "VISION_UNAVAILABLE", message: "The vision service could not be reached. You can still draw the placement area." },
      { status: 503 },
    );
  }
}
