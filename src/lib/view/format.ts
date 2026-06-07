// Pure formatting helpers shared by server routes and client components.

export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  const fraction = cents % 100 === 0 ? 0 : 2;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  })}`;
}

export function estPayoutCents(priceCents: number | null | undefined): number | null {
  if (priceCents == null) return null;
  return Math.round(priceCents * 0.9);
}

const CONDITION_LABEL: Record<string, string> = {
  new_with_tags: "New with tags",
  new_without_tags: "New without tags",
  used_excellent: "Used — Excellent",
  used_good: "Used — Good",
  used_fair: "Used — Fair",
  for_parts: "For parts",
  unknown: "Unknown",
};

export function conditionLabel(condition: string): string {
  return CONDITION_LABEL[condition] ?? condition;
}

const CATEGORY_LABEL: Record<string, string> = {
  sneakers: "Sneakers",
  streetwear: "Streetwear",
  hype_fashion: "Hype fashion",
  accessories: "Accessories",
  other: "Other",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function durationLabel(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Splits a title like "Air Jordan 1 — Lost & Found" so the suffix can be
// rendered in italic serif, matching the design's title treatment.
export function splitTitle(title: string): { head: string; tail: string | null } {
  const idx = title.indexOf(" — ");
  if (idx === -1) return { head: title, tail: null };
  return { head: title.slice(0, idx), tail: title.slice(idx + 3) };
}
