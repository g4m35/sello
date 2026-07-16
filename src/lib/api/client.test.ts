import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }),
    },
  }),
}));

import { api } from "./client";

describe("API client read timeouts", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects a stalled listing request with safe retry copy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const request = api.getItem("session-token", "item-1").then(
      () => "resolved",
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    const outcome = await Promise.race([request, Promise.resolve("still-pending")]);

    expect(outcome).toEqual({
      error: "The request took too long. Please try again.",
      status: 408,
    });
  });
});

describe("bulk photo direct upload", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads bytes to Supabase before registering metadata with the app", async () => {
    const batchId = "10000000-0000-4000-8000-000000000001";
    const path = `bulk/account-1/${batchId}/photo.jpg`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uploads: [
              {
                uploadId: "30000000-0000-4000-8000-000000000010",
                bucket: "private",
                path,
                token: "signed-token",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ batch: { id: batchId, photoCount: 1 } }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue("30000000-0000-4000-8000-000000000010"),
    });
    mocks.uploadToSignedUrl.mockResolvedValue({ data: { path }, error: null });
    const file = new File([new Uint8Array([1, 2, 3])], "front.jpg", {
      type: "image/jpeg",
    });

    await expect(api.uploadBulkPhotos("session-token", batchId, [file])).resolves.toEqual({
      batch: { id: batchId, photoCount: 1 },
    });

    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      path,
      "signed-token",
      file,
      { contentType: "image/jpeg", upsert: false },
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/bulk/batches/${batchId}/photos/uploads`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/bulk/batches/${batchId}/photos`);
    const registration = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(registration.photos[0]).toEqual(
      expect.objectContaining({
        uploadId: "30000000-0000-4000-8000-000000000010",
        storagePath: path,
        sizeBytes: 3,
      }),
    );
  });
});
