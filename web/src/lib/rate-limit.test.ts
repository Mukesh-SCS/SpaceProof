import { describe, expect, it } from "vitest";
import { advanceWindow } from "@/lib/rate-limit";

describe("shared request window", () => {
  it("allows a burst and then asks the caller to wait until the window resets", () => {
    const first = advanceWindow(null, 1_000, 2, 60_000);
    expect(first.ok).toBe(true);
    const second = advanceWindow(first.state, 1_100, 2, 60_000);
    expect(second.ok).toBe(true);
    const blocked = advanceWindow(second.state, 1_200, 2, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    const later = advanceWindow(blocked.state, 61_000, 2, 60_000);
    expect(later.ok).toBe(true);
    expect(later.state.count).toBe(1);
  });
});
