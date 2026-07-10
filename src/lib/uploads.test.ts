import { describe, expect, it } from "vitest";

import { extractBulkPhotos, extractListingPhotos } from "./uploads";

function image(name: string, type = "image/jpeg") {
  return new File(["photo"], name, { type });
}

describe("extractListingPhotos", () => {
  it("accepts one to three image files from a multipart request", () => {
    const formData = new FormData();
    formData.append("photos", image("front.jpg"));
    formData.append("photos", image("tag.png", "image/png"));

    const result = extractListingPhotos(formData);

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("front.jpg");
    expect(result[1]?.type).toBe("image/png");
  });

  it("rejects requests without photos", () => {
    const formData = new FormData();

    expect(() => extractListingPhotos(formData)).toThrow(
      "Upload 1 to 3 item photos.",
    );
  });

  it("rejects requests with more than three photos", () => {
    const formData = new FormData();
    formData.append("photos", image("1.jpg"));
    formData.append("photos", image("2.jpg"));
    formData.append("photos", image("3.jpg"));
    formData.append("photos", image("4.jpg"));

    expect(() => extractListingPhotos(formData)).toThrow(
      "Upload 1 to 3 item photos.",
    );
  });

  it("rejects non-image files", () => {
    const formData = new FormData();
    formData.append("photos", new File(["not an image"], "notes.txt", { type: "text/plain" }));

    expect(() => extractListingPhotos(formData)).toThrow(
      "Only JPEG, PNG, WEBP, and HEIC photos are supported.",
    );
  });
});

describe("extractBulkPhotos", () => {
  it("uses the caller's server-side remaining-photo cap", () => {
    const formData = new FormData();
    formData.append("photos", image("1.jpg"));
    formData.append("photos", image("2.jpg"));

    expect(extractBulkPhotos(formData, 2)).toHaveLength(2);
    expect(() => extractBulkPhotos(formData, 1)).toThrow(
      "Upload 1 to 1 photos without exceeding your batch limit.",
    );
  });

  it("blocks uploads after a batch reaches its plan-derived cap", () => {
    const formData = new FormData();
    formData.append("photos", image("1.jpg"));
    expect(() => extractBulkPhotos(formData, 0)).toThrow(
      "This batch has reached its photo limit.",
    );
  });
});
