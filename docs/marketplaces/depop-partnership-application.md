# Depop Selling API — partnership application (owner to send)

Status: DRAFT for the owner. Not sent by any agent. Send from the business
address to partnerships@depop.com. The Selling API is private; access requires
Depop approval (docs: https://partnerapi.depop.com/api-docs/).

---

Subject: Selling API partnership request — Sello (crosslisting tool for resale sellers)

Hi Depop Partnerships,

I run Sello (https://sello.wtf), a listing tool for individual resale sellers.
Sellers photograph an item once; Sello drafts the listing (title, description,
condition, flaws, measurements, pricing from sold comps) and publishes it to the
marketplaces the seller selects, then keeps inventory state in sync so an item
sold on one channel is promptly delisted from the others.

We currently integrate eBay, Etsy, and StockX through their official APIs, with
seller-authorized OAuth, server-side readiness validation, audited publish
attempts, and fail-closed feature gates. Depop is one of our most requested
channels; today we only offer manual copy-ready drafts, and we would like to
replace that with a proper integration through the Selling API.

What we would build first (drafts-first, mirroring our Etsy rollout):
- Seller-authorized OAuth connection to their own Depop shop
- Product create/update via your SKU-based upsert, seller-reviewed before
  anything goes live
- Order retrieval to power sold-detection and cross-marketplace delisting
- Sandbox validation before any production listing

Scopes we expect to need: products_read, products_write, orders_read, shop_read
(offers scopes later, if we add offer automation).

Volume expectations are modest and organic: individual sellers listing their own
inventory, no bulk or automated spam patterns, strict per-seller rate limiting on
our side.

Could you share the application requirements and next steps for API access,
including sandbox credentials?

Thanks,
[Owner name]
[Business entity, address]
[Contact email / phone]

---

Checklist before sending:
- [ ] Fill the bracketed fields
- [ ] Confirm the business entity details match the Depop account
- [ ] After approval: store credentials only in Vercel env (never the repo),
      then build Phase B (`feature/depop-api-foundation`) per the design spec.
