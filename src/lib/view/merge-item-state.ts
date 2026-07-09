import type { ItemDetailView } from "@/lib/view/types";

/**
 * Merge the server-recomputed derived state from a save response into the
 * editor's current item, so the readiness checklist, status badge, and
 * marketplace state update live without a full reload.
 *
 * Only server-derived fields are taken from `saved`; the editor's editable
 * fields stay sourced from local form state, and the existing photos are kept
 * because save responses are built without signed photo URLs.
 */
export function mergeSavedItemState(
  prev: ItemDetailView,
  saved: ItemDetailView,
): ItemDetailView {
  return {
    ...prev,
    readiness: saved.readiness,
    status: saved.status,
    statusLabel: saved.statusLabel,
    lifecycleState: saved.lifecycleState,
    channels: saved.channels,
    priceCents: saved.priceCents,
    stockxMatch: saved.stockxMatch,
  };
}
