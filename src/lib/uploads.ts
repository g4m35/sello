import { ValidationError } from "./errors";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_LISTING_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function extractListingPhotos(formData: FormData): File[] {
  const values = formData.getAll("photos");
  const photos = values.filter((value): value is File => value instanceof File);

  if (photos.length < 1 || photos.length > MAX_LISTING_PHOTOS) {
    throw new ValidationError("Upload 1 to 3 item photos.");
  }

  for (const photo of photos) {
    if (!ALLOWED_IMAGE_TYPES.has(photo.type)) {
      throw new ValidationError("Only JPEG, PNG, WEBP, and HEIC photos are supported.");
    }

    if (photo.size > MAX_PHOTO_BYTES) {
      throw new ValidationError("Each photo must be 8MB or smaller.");
    }
  }

  return photos;
}
