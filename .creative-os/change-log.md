# Sello Studio changes

| Before | After | Why |
|---|---|---|
| Duplicate sidebar inventory/channel fetches and blanket route prefetch | Navigation fetches only on intent; no sidebar data fetch | Remove redundant work and stale counts. |
| Small thumbnail table as default, repeated per-cell links | Photo catalog by default; selectable list view, one item link per row | Recognize physical inventory and reduce keyboard stops. |
| Duplicate summary counts and nine inactive marketplace marks | Status filters and actual active/pending/failed channel marks only | Keep status honest and remove noise. |
| Select-all implied current page but selected hidden pages; filtered count hid selected rows | Select current page; count all selected existing items, including filtered-out rows | Make the scope of bulk actions explicit. |
| Uniform single-column editor with internal record IDs and guessed payouts | Object gallery, separate details/pricing, section links and review rail; actual SKU only | Find the item and its next action without irrelevant diagnostics or unsupported financial estimates. |
| Single broad upload panel | Photo capture area, item/label/detail guidance and separate explicit posting authorization | Make the first step clear while preserving consent and price bounds. |
| Hover-lifting cards, route entrances, tiny controls | Quiet surfaces, readable type, purposeful state feedback, larger controls | Reduce movement and improve keyboard/touch use. |
| Hand-copied SVG paths and unfocused div modals | Official Lucide components and Radix Dialog/Progress | Delete duplicated drawing code and use maintained accessible mechanics. |
| Offscreen mobile navigation remained keyboard-accessible | Hidden closed drawer, contained open focus, inert background and focus restoration | Prevent keyboard interaction with obscured content. |
| Inconsistent settings/feedback form styling | Shared studio styling and a real labeled feedback form | Keep secondary workflows consistent with the seller workspace. |

Unchanged foundations: marketplace authorization, account scoping, quotas, sold-state checks, publish idempotency, price evidence gates and editor autosave. No production transaction or deployment was used to verify this UI.
