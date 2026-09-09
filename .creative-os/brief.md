# Sello Studio · authorized design brief

Audience: independent resale sellers, working on phones during intake and desktop for reviewing many items. They need to recognize their physical inventory, see what is unfinished, and trust what has actually posted. The core action is add photos → prepare → review exceptions → publish with valid authorization.

Hypothesis: a photo-first catalog, visible work states, and a split listing workspace will let a seller locate an item and its next required action without opening multiple screens. Verify with populated, empty, failed, and narrow-screen fixtures; existing server gates remain the source of truth. We do not claim a measured conversion improvement.

Mode: hybrid, client-preview delivery. Scope: the complete authenticated seller interface and shared visual primitives, including navigation, inventory, intake, editor, overview, history, channels, settings and billing. Public marketing keeps its distinct storytelling; shared controls receive the same accessible mechanics. No backend safety relaxation, live transactions, migration, merge or deployment.

## Three divergent directions

1. Dispatch desk: an exception inbox, dense ledger, compact monospace operational details, newest work first. Strong for professional throughput; needs reliable queue priorities; weak when sellers identify products visually. Keyboard density and mobile table overflow are risks. Reject if finding an object requires reading every title.
2. Resale studio (selected): a catalog of real item photographs, clear sans typography, spacious work surface, persistent navigation and a separate publishing rail. Inventory is the entry point; review stays next to the object. Requires actual item images and honest status data already present. Avoid oversized decorative cards; keep one primary action. Wrong if basic edits require more steps than the existing editor.
3. Guided lane: one item and one decision per screen, conversational headings, a sequential preparation flow. Friendly to first-time sellers but obscures experienced sellers’ inventory and batch work. Rejected because the repeated navigation costs outweigh onboarding benefits.

## Page physics

Topology: persistent utility sidebar with a fluid catalog; editor is a document with anchored sections plus an action rail. Navigation: visible primary inventory/activity/channels links, secondary workspace links; on mobile use a dismissible, keyboard-contained drawer. Scroll: native document scroll, no reveal choreography. Metaphor: photograph the object, prepare its record, dispatch only when ready. Motion: 120–200ms state feedback only, no card lifting or route entrances; preserve the existing brand loading outline with reduced-motion fallback. Mobile: single column, filters wrap/scroll inside their region, readable cards replace dense inventory tables, 48px primary targets. No content hidden solely for aesthetics.

## Research principles, not templates

- Shopify inventory documentation: explicit filtering and search support large collections. https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/viewing-inventory
- Linear Inbox: surface actionable attention rather than undifferentiated activity. https://linear.app/docs/inbox
- V&A collections: object imagery supports recognition. https://www.vam.ac.uk/collections
- Material state guidance: communicate state with labels and shape as well as color. https://m3.material.io/foundations/interaction/states/overview

## Acceptance and constraints

Real counts only; distinguish prepared, ready, active and sold. Automatic posting remains explicit per-item consent and bounded price authorization. Preserve autosave, retries, account scoping and server preflight. Provide visible errors, labeled controls, keyboard focus, modal focus containment, reduced motion, no page overflow at 390px, SSR content, and full repository validation. Budget: no new image/video assets, no animation framework, two small headless packages; production build and preview timing smoke checked. Human taste acceptance remains pending owner screenshot review. Preview evidence does not authorize production.

## Bounded component trial

Radix Dialog for modal focus/escape behavior; Radix Progress for known readiness state; Lucide Camera for the authored photo-capture composition. Registry entries are project-local clearance records, not claims of shared adoption. Official packages and licenses checked before installation. Success: accessible behavior and real usage in the redesigned screens. Rollback: revert this UI commit, retain prior autonomy commits. Do not reuse this direction blindly for non-inventory products.
