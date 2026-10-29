/** Buyer photographs. Pixel size is not a room measurement. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export function rejectRoomUpload(file: { size: number; type: string }): { status: number; message: string } | null {
  if (file.size <= 0) {
    return { status: 400, message: "Choose a JPEG or PNG photograph." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { status: 413, message: "The photograph is larger than 8 MB." };
  }
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_TYPES.has(type)) {
    return { status: 415, message: "Upload a JPEG or PNG photograph." };
  }
  return null;
}

export function rejectDeclaredBody(contentLength: string | null): { status: number; message: string } | null {
  if (!contentLength) return null;
  const declared = Number(contentLength);
  if (!Number.isFinite(declared)) return null;
  if (declared > MAX_IMAGE_BYTES + 64 * 1024) {
    return { status: 413, message: "The photograph is larger than 8 MB." };
  }
  return null;
}
