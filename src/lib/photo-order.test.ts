import { describe, expect, it } from "vitest";

import { coverOrder } from "@/lib/photo-order";

describe("coverOrder", () => {
  it("moves the chosen id to the front, preserving the rest", () => {
    expect(coverOrder(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });
  it("is a no-op when the id is already first", () => {
    expect(coverOrder(["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
  });
  it("returns the input unchanged when the id is absent", () => {
    expect(coverOrder(["a", "b"], "z")).toEqual(["a", "b"]);
  });
});
