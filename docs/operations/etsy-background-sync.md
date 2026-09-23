# Etsy background synchronization

Etsy monitoring and cross-marketplace removal use the same durable SyncJob queue as eBay and StockX. They do not enable Etsy production access.

The existing minute cron schedules up to 25 due Etsy listings per run, at least five minutes after their last successful check. Scheduling requires a valid enabled Etsy configuration and an account-scoped connected shop. Row locks and per-window idempotency prevent concurrent scheduling; pending, exhausted, canceled or review-required checks are not silently restarted.

Before provider execution, the worker verifies the initiating user, current account membership, and the seller's Etsy `orders` capability for status reads or `delist` capability for removals. The authenticated adapter resolves the shop and refreshes credentials. Sale status passes through the shared Etsy status service and transactional canonical sold-state handling, preserving conflicting sale sources and queuing other marketplace removals.

A delist reads the remote listing before issuing deactivation and reads it again afterwards. Local success requires the same external listing ID and an observed inactive, expired or removed state. A remote sold/unknown state, changed local snapshot, provider error or unconfirmed deactivation creates manual review; the worker never blindly retries a possibly applied write. Status reads retry temporary failures with existing bounded backoff, then create a visible review task and notification when blocked or exhausted.

Production currently has no Etsy credentials configured (verified separately by the integrating owner). To enable service later requires valid application access, the required credentials, an Etsy shop connection and per-seller capability authorization. Existing manually parked Etsy jobs remain parked until explicit recovery; this change does not republish listings or retrospectively authorize actions.

Validation uses injected providers and synthetic database fixtures only. No live Etsy requests, marketplace mutations, production migrations or configuration changes were performed.
