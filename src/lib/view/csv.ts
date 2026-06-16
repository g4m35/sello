import type { ItemView } from "@/lib/view/types";

// Cells beginning with one of these are interpreted as a formula by Excel /
// Google Sheets / LibreOffice. Prefixing a single quote forces text and is
// stripped by spreadsheet apps on display, so the value round-trips visually.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (FORMULA_TRIGGER.test(s)) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ItemView[]): string {
  const header = [
    "id", "title", "brand", "category", "condition", "size", "color",
    "price_usd", "status", "photos", "updated_at",
  ];
  const lines = [header.join(",")];
  for (const it of rows) {
    lines.push(
      [
        it.id, it.title, it.brand ?? "", it.category, it.condition, it.size ?? "",
        it.colorway ?? "",
        it.priceCents != null ? (it.priceCents / 100).toFixed(2) : "",
        it.statusLabel, it.photoCount, it.updatedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
