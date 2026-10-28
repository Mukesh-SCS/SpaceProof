export function visionServiceUrl(): string {
  return (process.env.VISION_SERVICE_URL || "http://localhost:8000").replace(/\/$/, "");
}

export async function forwardVisionJson(path: string, body: unknown): Promise<Response> {
  try {
    const response = await fetch(`${visionServiceUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
