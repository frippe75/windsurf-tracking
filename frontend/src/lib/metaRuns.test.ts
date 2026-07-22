import { describe, it, expect } from "vitest";
import { pruneMeta, hasAllKeys } from "./metaRuns";

describe("pruneMeta", () => {
  it("drops keys not in the current schema (removes stale/mock fields)", () => {
    const stored = { sea_state: "chop", Action: "Cruising", Intensity: "Low" };
    expect(pruneMeta(stored, new Set(["sea_state", "wind_strength"]))).toEqual({ sea_state: "chop" });
  });
  it("handles undefined", () => {
    expect(pruneMeta(undefined, new Set(["x"]))).toEqual({});
  });
});

describe("hasAllKeys", () => {
  it("true only when every key has a non-empty value", () => {
    expect(hasAllKeys({ a: "1", b: "2" }, ["a", "b"])).toBe(true);
    expect(hasAllKeys({ a: "1" }, ["a", "b"])).toBe(false);
    expect(hasAllKeys({ a: "1", b: "" }, ["a", "b"])).toBe(false);
    expect(hasAllKeys(undefined, ["a"])).toBe(false);
  });
  it("empty key list is trivially complete", () => {
    expect(hasAllKeys(undefined, [])).toBe(true);
  });
});
