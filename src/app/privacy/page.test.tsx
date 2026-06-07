import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  it("describes sandbox marketplace data handling without exposing internals", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain("sello Privacy Notice");
    expect(html).toContain("Last updated: May 31, 2026");
    expect(html).toContain("Supabase");
    expect(html).toContain("item photos");
    expect(html).toContain("listing drafts and inventory data");
    expect(html).toContain("marketplace connection data");
    expect(html).toContain("eBay OAuth tokens");
    expect(html).toContain("encrypted server-side");
    expect(html).toContain("disconnect eBay");
    expect(html).not.toContain("EBAY_CLIENT_SECRET");
    expect(html).not.toContain("EBAY_TOKEN_ENCRYPTION_KEY");
  });
});
