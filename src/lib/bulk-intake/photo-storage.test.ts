import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import {
  bulkPhotoStoragePath,
  inspectBulkPhotoHeader,
  validateStoredBulkPhoto,
} from "./photo-storage";

const uploadId = "30000000-0000-4000-8000-000000000010";

function validJpeg() {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0x64,
    0x00, 0xc8,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

describe("bulk photo storage", () => {
  it("derives storage paths from the authenticated account and owned batch", () => {
    expect(
      bulkPhotoStoragePath("account-1", "batch-1", {
        uploadId,
        mimeType: "image/jpeg",
      }),
    ).toBe(`bulk/account-1/batch-1/${uploadId}.jpg`);
  });

  it("recognizes JPEG magic bytes and dimensions from a bounded header", () => {
    expect(inspectBulkPhotoHeader(validJpeg())).toEqual({
      mimeType: "image/jpeg",
      width: 200,
      height: 100,
      dimensionsRequired: true,
    });
  });

  it("does not accept an HEIF brand without verifiable image dimensions", async () => {
    const declaredSize = 24;
    const files = {
      info: vi.fn().mockResolvedValue({
        data: { size: declaredSize, contentType: "image/heif" },
        error: null,
      }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: "https://storage.test/photo" },
        error: null,
      }),
    } as never;
    const brandedOnly = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x6d, 0x69, 0x66, 0x31,
      0x00, 0x00, 0x00, 0x00,
      0x6d, 0x69, 0x66, 0x31,
      0x68, 0x65, 0x69, 0x66,
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(brandedOnly, { status: 206 }),
    ) as unknown as typeof fetch;

    await expect(
      validateStoredBulkPhoto(
        files,
        {
          uploadId,
          originalName: "front.heif",
          mimeType: "image/heif",
          sizeBytes: declaredSize,
          storagePath: `bulk/account-1/batch-1/${uploadId}.heif`,
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 400, code: "BULK_PHOTO_INVALID" });
  });

  it("rejects a declared JPEG whose stored bytes are not a JPEG", async () => {
    const files = {
      info: vi.fn().mockResolvedValue({
        data: { size: 4, contentType: "image/jpeg" },
        error: null,
      }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: "https://storage.test/photo" },
        error: null,
      }),
    } as never;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 206 }),
    ) as unknown as typeof fetch;

    await expect(
      validateStoredBulkPhoto(
        files,
        {
          uploadId,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 4,
          storagePath: `bulk/account-1/batch-1/${uploadId}.jpg`,
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 400, code: "BULK_PHOTO_INVALID" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://storage.test/photo",
      expect.objectContaining({ headers: { Range: "bytes=0-65535" } }),
    );
  });

  it("rejects stored size or MIME metadata that differs from the declaration", async () => {
    const files = {
      info: vi.fn().mockResolvedValue({
        data: { size: 99, contentType: "image/png" },
        error: null,
      }),
    } as never;
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      validateStoredBulkPhoto(
        files,
        {
          uploadId,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 4,
          storagePath: `bulk/account-1/batch-1/${uploadId}.jpg`,
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 400, code: "BULK_PHOTO_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
