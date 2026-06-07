import type { ItemView } from "@/lib/view/types";

export type SortValue =
  | "updated_desc"
  | "updated_asc"
  | "price_desc"
  | "price_asc"
  | "title_asc";

export const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: "updated_desc", label: "Recently updated" },
  { value: "updated_asc", label: "Oldest updated" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "title_asc", label: "Title: A to Z" },
];

// Pure, stable inventory sort. Items without a price sort last for price sorts.
export function sortItems(list: ItemView[], sort: SortValue): ItemView[] {
  const price = (i: ItemView) => i.priceCents ?? -1;
  const copy = [...list];
  switch (sort) {
    case "updated_asc":
      return copy.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    case "price_desc":
      return copy.sort((a, b) => price(b) - price(a));
    case "price_asc":
      return copy.sort((a, b) => price(a) - price(b));
    case "title_asc":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "updated_desc":
    default:
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
