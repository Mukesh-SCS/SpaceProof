import { rateLimitedResponse } from "@/lib/rate-limit";
import { forwardVisionJson } from "@/lib/vision/proxy";

export async function POST(request: Request) {
  const limited = await rateLimitedResponse(request, "vision-preferences", 20);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }
  const text = body && typeof body === "object" && "requestText" in body ? body.requestText : "";
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ message: "Describe the desk you want." }, { status: 400 });
  }
  return forwardVisionJson("/interpret-request", { request_text: text.trim().slice(0, 2000) });
}
