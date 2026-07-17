import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PUBLIC_CONTACT_EMAIL } from "@/lib/contact";

import ContactPage, { metadata } from "./page";

describe("ContactPage", () => {
  it("renders the public contact email and mailto link", () => {
    const html = renderToStaticMarkup(<ContactPage />);

    expect(metadata.title).toContain("Contact");
    expect(html).toContain("Talk to Sello.");
    expect(html).toContain(PUBLIC_CONTACT_EMAIL);
    expect(html).toContain(`mailto:${PUBLIC_CONTACT_EMAIL}`);
    expect(html).toContain("Back to landing page");
  });
});
