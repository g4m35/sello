import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UsageMeter } from "./usage-meter";

describe("UsageMeter", () => {
  it("renders the used / limit counts", () => {
    const html = renderToStaticMarkup(<UsageMeter label="AI listings" used={7} limit={10} />);
    expect(html).toContain("AI listings");
    expect(html).toContain("7 / 10");
  });

  it("flags an at-limit meter in red", () => {
    const html = renderToStaticMarkup(<UsageMeter label="Comps" used={10} limit={10} />);
    expect(html).toContain("usage-meter__value--limit");
    expect(html).toContain("usage-meter__fill--limit");
  });

  it("computes the bar width from the ratio", () => {
    const html = renderToStaticMarkup(<UsageMeter label="X" used={5} limit={10} />);
    expect(html).toContain("width:50%");
  });
});
