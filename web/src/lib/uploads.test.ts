import { describe, expect, it } from "vitest";
import { rejectDeclaredBody, rejectRoomUpload } from "@/lib/uploads";

describe("room uploads", () => {
  it("accepts a JPEG or PNG inside the size limit", () => {
    expect(rejectRoomUpload({ size: 1200, type: "image/jpeg" })).toBeNull();
    expect(rejectRoomUpload({ size: 1200, type: "image/png" })).toBeNull();
  });

  it("rejects an empty file, a non-image, and a file over 8 MB", () => {
    expect(rejectRoomUpload({ size: 0, type: "image/jpeg" })?.status).toBe(400);
    expect(rejectRoomUpload({ size: 100, type: "text/plain" })?.status).toBe(415);
    expect(rejectRoomUpload({ size: 100, type: "" })?.status).toBe(415);
    expect(rejectRoomUpload({ size: 8 * 1024 * 1024 + 1, type: "image/jpeg" })?.status).toBe(413);
  });

  it("rejects a declared body that is already larger than 8 MB", () => {
    expect(rejectDeclaredBody(String(9 * 1024 * 1024))?.status).toBe(413);
    expect(rejectDeclaredBody(null)).toBeNull();
  });
});
