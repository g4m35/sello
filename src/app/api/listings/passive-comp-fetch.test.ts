import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression guard: a prior bug had the item detail load passively trigger eBay
// Browse comps. Auto comps may only run from the draft-generation POST and the
// explicit refresh POST — never from a GET/detail/editor load.
function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("no passive comp fetch on detail/editor load", () => {
  it("the item detail route never calls runCompFetch", () => {
    const sql = source("src/app/api/listings/[id]/route.ts");
    expect(sql).not.toContain("runCompFetch");
    expect(sql).not.toContain("enabledCompSources");
  });

  it("the comps GET route never calls runCompFetch", () => {
    const sql = source("src/app/api/listings/comps/route.ts");
    expect(sql).not.toContain("runCompFetch");
  });

  it("auto comp fetching is wired only to the draft and refresh POST routes", () => {
    expect(source("src/app/api/listings/draft/route.ts")).toContain("runCompFetch");
    expect(source("src/app/api/listings/comps/refresh/route.ts")).toContain("runCompFetch");
  });
});
