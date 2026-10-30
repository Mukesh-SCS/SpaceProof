export function visionServiceUrl(): string {
  return (process.env.VISION_SERVICE_URL || "http://localhost:8000").replace(/\/$/, "");
}

/** Server-only. Never read this from a NEXT_PUBLIC_ variable. */
export function visionServiceToken(): string {
  return process.env.VISION_SERVICE_TOKEN?.trim() ?? "";
}

export function visionAuthHeaders(): Record<string, string> | null {
  const token = visionServiceToken();
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export function visionAuthFailure(): Response {
  return Response.json(
    {
      code: "VISION_AUTH_NOT_CONFIGURED",
      message: "The vision service token is not configured on the web server.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function forwardVisionJson(path: string, body: unknown): Promise<Response> {
  const auth = visionAuthHeaders();
  if (!auth) return visionAuthFailure();
  try {
    const response = await fetch(`${visionServiceUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
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
