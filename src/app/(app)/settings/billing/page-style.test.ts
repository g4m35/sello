import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/app/(app)/settings/billing/page.tsx"),
  "utf8",
);

describe("billing settings page styling", () => {
  it("uses Sello theme primitives instead of hardcoded neutral Tailwind colors", () => {
    expect(source).toContain("<Topbar");
    expect(source).toContain('className="page"');
    expect(source).toContain('className="card"');
    expect(source).not.toMatch(/text-neutral-|border-neutral-|bg-red-|text-red-/);
  });
});
