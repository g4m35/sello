# Sello Studio preview verification

The screenshots show actual Sello source components bundled with synthetic inventory/API fixtures. Product silhouettes are local illustration fixtures; they are not actual seller photographs or product-identification claims. Fonts match the Next production build.

- `desktop.png`, `mobile-390.png`: inventory at desktop and an exact 390px mobile viewport. Scrollbars are hidden through Chrome's device-emulation API for mobile capture, matching an overlay-scrollbar phone; CSS is not modified to resize the screenshot.
- `*-desktop.png`, `*-mobile.png`: intake, editor, overview, history, channels, settings, billing, bulk intake and feedback; `inventory-dark.png` checks the alternate theme.
- `interaction-checks.json`: real keyboard, dialog, drawer, 30-item selection, error/empty-state checks and axe WCAG A/AA scans across ten seller screens.
- `final-interactions.json`: autosave during background preparation, opt-in price validation and dark-theme accessibility.
- `validation.txt`: full repository gate; `performance.json`: cloud fixture timing smoke, not production performance or RUM.

`console.json` and `geometry.json` are captured from the browser. The latter uses the unmodified Creative OS capture script. `verification-result.json` is recomputed after the final commit because it binds artifacts to Git HEAD. Derived gate/evidence JSON is intentionally gitignored to avoid a self-invalidating commit/hash cycle. Screenshot and test evidence remain committed.

Creative OS component gate passes. Final visual release approval is held for owner screenshot review; no owner acceptance is inferred from technical tests or model review. No production deployment was performed.
