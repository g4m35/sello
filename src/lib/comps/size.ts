// Preserve decimals: size 10.5 must never match size 10 or 105.
export function normalizedSize(value: string | null | undefined): string | null {
  const size = value?.trim().toLowerCase().replace(/^size\s*:?\s*/, "");
  if (!size || size === "unknown") return null;
  const aliases: Record<string, string> = { small: "s", medium: "m", large: "l", "extra large": "xl", "x-large": "xl" };
  return aliases[size] ?? size.replace(/\s+/g, " ");
}

export function sizeFromTitle(title: string): string | null {
  const match = title.match(/\bsize\s*:?\s*(\d+(?:\.\d+)?|xxxl|xxl|xl|xs|s|m|l|small|medium|large)\b/i);
  return normalizedSize(match?.[1]);
}
