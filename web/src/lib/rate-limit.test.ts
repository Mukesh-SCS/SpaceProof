import { describe, expect, it } from "vitest";
import { takeRateLimit } from "@/lib/rate-limit";

describe("request limiting", () => {
  it("allows a burst and then asks the caller to wait", () => {
    const key = `test-${Date.now()}`;
    expect(takeRateLimit(key, 2, 60_000, 1_000).ok).toBe(true);
    expect(takeRateLimit(key, 2, 60_000, 1_100).ok).toBe(true);
    const blocked = takeRateLimit(key, 2, 60_000, 1_200);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(takeRateLimit(key, 2, 60_000, 61_000).ok).toBe(true);
  });
});
