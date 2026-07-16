import { AppError, getRequiredEnv } from "@/lib/errors";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

import type { BulkPhotoUploadGrant } from "./types";
import type { BulkPhotoRegistrationInput, BulkPhotoUploadInput } from "./validation";

const EXTENSIONS_BY_MIME_TYPE: Record<BulkPhotoUploadInput["mimeType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const HEADER_BYTES = 64 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 50_000_000;

type StorageBucket = ReturnType<
  ReturnType<typeof createSupabaseServiceClient>["storage"]["from"]
>;

type ImageHeader = {
  mimeType: BulkPhotoUploadInput["mimeType"];
  width: number | null;
  height: number | null;
  dimensionsRequired: boolean;
};

function invalidPhoto(): AppError {
  return new AppError(
    "One or more uploaded photos could not be verified. Re-select the photos and try again.",
    400,
    "BULK_PHOTO_INVALID",
  );
}

function uploadUnavailable(): AppError {
  return new AppError(
    "Photo upload is temporarily unavailable. Please try again.",
    503,
    "BULK_UPLOAD_UNAVAILABLE",
  );
}

export function bulkPhotoStoragePath(
  accountId: string,
  batchId: string,
  photo: Pick<BulkPhotoUploadInput, "uploadId" | "mimeType">,
): string {
  return `bulk/${accountId}/${batchId}/${photo.uploadId}.${EXTENSIONS_BY_MIME_TYPE[photo.mimeType]}`;
}

export function getBulkPhotoStorage() {
  const bucket = getRequiredEnv("SUPABASE_STORAGE_BUCKET");
  return {
    bucket,
    files: createSupabaseServiceClient().storage.from(bucket),
  };
}

export async function createBulkPhotoUploadGrant(
  bucket: string,
  files: StorageBucket,
  accountId: string,
  batchId: string,
  photo: BulkPhotoUploadInput,
): Promise<BulkPhotoUploadGrant> {
  const path = bulkPhotoStoragePath(accountId, batchId, photo);
  const { data, error } = await files.createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.token || data.path !== path) throw uploadUnavailable();

  return { uploadId: photo.uploadId, bucket, path, token: data.token };
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    offset += length + 2;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const chunk = Buffer.from(bytes.subarray(12, 16)).toString("ascii");
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits =
      bytes[21]! |
      (bytes[22]! << 8) |
      (bytes[23]! << 16) |
      (bytes[24]! << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function heifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii") !== "ispe") continue;
    return {
      width:
        bytes[offset + 8]! * 0x1000000 +
        bytes[offset + 9]! * 0x10000 +
        bytes[offset + 10]! * 0x100 +
        bytes[offset + 11]!,
      height:
        bytes[offset + 12]! * 0x1000000 +
        bytes[offset + 13]! * 0x10000 +
        bytes[offset + 14]! * 0x100 +
        bytes[offset + 15]!,
    };
  }
  return null;
}

export function inspectBulkPhotoHeader(bytes: Uint8Array): ImageHeader | null {
  if (
    bytes.length >= 24 &&
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ) &&
    Buffer.from(bytes).readUInt32BE(8) === 13 &&
    Buffer.from(bytes.subarray(12, 16)).toString("ascii") === "IHDR"
  ) {
    return {
      mimeType: "image/png",
      width: Buffer.from(bytes).readUInt32BE(16),
      height: Buffer.from(bytes).readUInt32BE(20),
      dimensionsRequired: true,
    };
  }
  if (bytes.length >= 9 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = jpegDimensions(bytes);
    return {
      mimeType: "image/jpeg",
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      dimensionsRequired: true,
    };
  }
  if (
    bytes.length >= 30 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    const dimensions = webpDimensions(bytes);
    return {
      mimeType: "image/webp",
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      dimensionsRequired: true,
    };
  }
  if (bytes.length >= 16 && Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp") {
    const majorBrand = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
    if (majorBrand === "avif" || majorBrand === "avis") return null;
    const boxLength = Math.min(Buffer.from(bytes).readUInt32BE(0), bytes.length);
    const brands = new Set<string>();
    for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
      brands.add(Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii"));
    }
    const heic = ["heic", "heix", "hevc", "hevx"].some((brand) => brands.has(brand));
    const heif = heic || ["mif1", "msf1"].some((brand) => brands.has(brand));
    if (heif) {
      const dimensions = heifDimensions(bytes);
      return {
        mimeType: heic ? "image/heic" : "image/heif",
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        dimensionsRequired: true,
      };
    }
  }
  return null;
}

async function readStorageHeader(
  files: StorageBucket,
  path: string,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const { data, error } = await files.createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw uploadUnavailable();

  let response: Response;
  try {
    response = await fetchImpl(data.signedUrl, {
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw uploadUnavailable();
  }
  if (!response.ok || !response.body) {
    if (response.status >= 500) throw uploadUnavailable();
    throw invalidPhoto();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = HEADER_BYTES - total;
      const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function compatibleMimeType(actual: string, declared: string): boolean {
  const heifTypes = new Set(["image/heic", "image/heif"]);
  return actual === declared || (heifTypes.has(actual) && heifTypes.has(declared));
}

export async function validateStoredBulkPhoto(
  files: StorageBucket,
  declaration: BulkPhotoRegistrationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { data, error } = await files.info(declaration.storagePath);
  if (error) {
    if (error.status === 400 || error.status === 404) throw invalidPhoto();
    throw uploadUnavailable();
  }
  if (!data) throw invalidPhoto();

  const contentType = data.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    data.size !== declaration.sizeBytes ||
    !contentType ||
    !compatibleMimeType(contentType, declaration.mimeType)
  ) {
    throw invalidPhoto();
  }

  const header = inspectBulkPhotoHeader(
    await readStorageHeader(files, declaration.storagePath, fetchImpl),
  );
  if (!header || !compatibleMimeType(header.mimeType, declaration.mimeType)) throw invalidPhoto();
  if (header.dimensionsRequired && (!header.width || !header.height)) throw invalidPhoto();
  if (
    header.width &&
    header.height &&
    (header.width > MAX_IMAGE_DIMENSION ||
      header.height > MAX_IMAGE_DIMENSION ||
      header.width * header.height > MAX_IMAGE_PIXELS)
  ) {
    throw new AppError(
      "One or more photos have dimensions that are too large. Resize them and try again.",
      400,
      "BULK_PHOTO_DIMENSIONS_TOO_LARGE",
    );
  }
}
