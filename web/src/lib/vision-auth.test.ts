import { afterEach, describe, expect, it, vi } from "vitest";
import { visionAuthFailure, visionAuthHeaders, visionServiceToken } from "@/lib/vision/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vision service token", () => {
  it("uses the server variable and does not fall back to a public name", () => {
    vi.stubEnv("VISION_SERVICE_TOKEN", "server-only-token");
    vi.stubEnv("NEXT_PUBLIC_VISION_SERVICE_TOKEN", "browser-token");
    expect(visionServiceToken()).toBe("server-only-token");
    expect(visionAuthHeaders()).toEqual({ Authorization: "Bearer server-only-token" });
    expect(visionAuthFailure().status).toBe(503);
  });

  it("fails closed when the server token is missing", () => {
    vi.stubEnv("VISION_SERVICE_TOKEN", "");
    expect(visionAuthHeaders()).toBeNull();
  });
});
