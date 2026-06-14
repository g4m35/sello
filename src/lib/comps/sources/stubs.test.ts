import { afterEach, describe, expect, it, vi } from "vitest";

import { apifyEbaySoldSource } from "./apify-ebay-sold";
import { depopActiveSource } from "./depop-active";
import { googleLensSource } from "./google-lens";
import { grailedSoldSource } from "./grailed-sold";
import { poshmarkSoldSource } from "./poshmark-sold";
import type { CompQuery } from "@/lib/comps/source";

const query: CompQuery = {
  styleCode: null,
  brand: "Nike",
  title: "Air Jordan 1",
  size: "10",
  category: "sneakers",
  keywords: "Nike Air Jordan 1",
};

const cases = [
  {
    source: apifyEbaySoldSource,
    env: "APIFY_TOKEN",
    flag: "PRICE_COMP_APIFY_EBAY_SOLD_ENABLED",
    sold: true,
  },
  {
    source: grailedSoldSource,
    env: "GRAILED_COMPS_API_KEY",
    flag: "PRICE_COMP_GRAILED_SOLD_ENABLED",
    sold: true,
  },
  {
    source: poshmarkSoldSource,
    env: "POSHMARK_COMPS_API_KEY",
    flag: "PRICE_COMP_POSHMARK_SOLD_ENABLED",
    sold: true,
  },
  {
    source: depopActiveSource,
    env: "DEPOP_COMPS_API_KEY",
    flag: "PRICE_COMP_DEPOP_ACTIVE_ENABLED",
    sold: false,
  },
  {
    source: googleLensSource,
    env: "GOOGLE_LENS_API_KEY",
    flag: "PRICE_COMP_GOOGLE_LENS_ENABLED",
    sold: false,
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("external comp source stubs", () => {
  for (const { source, env, flag, sold } of cases) {
    it(`${source.id} is disabled without ${env}/${flag} and reports sold=${sold}`, () => {
      vi.stubEnv(env, "");
      vi.stubEnv(flag, "");
      expect(source.isEnabled()).toBe(false);
      expect(source.sold).toBe(sold);
    });

    it(`${source.id} is enabled once ${env} and ${flag} are set`, () => {
      vi.stubEnv(env, "configured");
      vi.stubEnv(flag, "true");
      expect(source.isEnabled()).toBe(true);
    });

    it(`${source.id} returns no invented comps`, async () => {
      vi.stubEnv(env, "configured");
      vi.stubEnv(flag, "true");
      await expect(source.fetchComps(query)).resolves.toEqual([]);
    });
  }
});
