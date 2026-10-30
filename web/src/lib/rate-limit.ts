import { prisma } from "@/lib/db/prisma";

/**
 * Decision used by the PostgreSQL counter. An in-memory map is not the
 * production limiter: a Render restart or a second instance would not share it.
 * The deployed counter is the ApiRateWindow table, which every web instance
 * that uses the same DATABASE_URL can see.
 *
 * It does not stop a client who bypasses this app, and it does not survive
 * a database outage. If the table cannot be updated, the AI routes fail closed.
 */
export interface WindowState {
  count: number;
  resetAt: number;
}

export function advanceWindow(
  current: WindowState | null,
  now: number,
  limit: number,
  windowMs: number,
): { state: WindowState; ok: boolean; retryAfterSeconds: number } {
  if (!current || now >= current.resetAt) {
    return { state: { count: 1, resetAt: now + windowMs }, ok: true, retryAfterSeconds: 0 };
  }
  const count = current.count + 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return {
    state: { count, resetAt: current.resetAt },
    ok: count <= limit,
    retryAfterSeconds,
  };
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

export async function takeSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "ApiRateWindow" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "ApiRateWindow"."resetAt" <= ${now} THEN 1
        ELSE "ApiRateWindow"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "ApiRateWindow"."resetAt" <= ${now} THEN ${resetAt}
        ELSE "ApiRateWindow"."resetAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `;
  const row = rows[0];
  if (!row || row.count <= limit) return { ok: true };
  const retryAfterSeconds = Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000));
  return { ok: false, retryAfterSeconds };
}

export async function rateLimitedResponse(request: Request, bucket: string, limit: number): Promise<Response | null> {
  try {
    const decision = await takeSharedRateLimit(`${bucket}:${clientAddress(request)}`, limit, 60_000);
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
  } catch {
    return Response.json(
      {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "The request limit could not be checked. Try again shortly.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
