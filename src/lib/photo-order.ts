// Returns the photo id order with `coverId` moved to the front (position 0),
// preserving the relative order of the rest. Returns the input unchanged when
// coverId is not present.
export function coverOrder(ids: string[], coverId: string): string[] {
  if (!ids.includes(coverId)) return ids;
  return [coverId, ...ids.filter((id) => id !== coverId)];
}
