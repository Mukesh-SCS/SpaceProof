/**
 * One process, one window. A Render restart clears it, and a second instance
 * does not share it. It slows accidental repeats. It is not a global quota.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { ok: true };
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

export function rateLimitedResponse(request: Request, bucket: string, limit: number): Response | null {
  const decision = takeRateLimit(`${bucket}:${clientAddress(request)}`, limit, 60_000);
  if (decision.ok) return null;
  return Response.json(
    { code: "RATE_LIMITED", message: "Too many requests. Wait a moment and try again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(decision.retryAfterSeconds),
      },
    },
  );
}
