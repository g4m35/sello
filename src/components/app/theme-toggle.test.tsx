import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  it("renders an accessible toggle in the light default (server) state", () => {
    const html = renderToStaticMarkup(<ThemeToggle />);

    expect(html).toContain('aria-label="Toggle color theme"');
    // Server/default snapshot is light, so it is not "pressed" and offers dark.
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('title="Switch to dark mode"');
    // Light state shows the moon (the thing you switch to).
    expect(html).toContain("M21 12.79A9 9");
  });
});
