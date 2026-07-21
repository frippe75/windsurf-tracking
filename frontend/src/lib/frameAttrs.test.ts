import { describe, it, expect } from "vitest";
import { scaleBucket, isTruncated, countDerived } from "./frameAttrs";
import { Annotation } from "@/types/annotation";

const ann = (bbox: any, excluded = false): Annotation => ({
  id: `a${Math.random()}`,
  instanceId: "i1",
  frameCreated: 0,
  points: [],
  bbox,
  isKeyframe: false,
  excluded,
});

describe("scaleBucket", () => {
  it("buckets by area fraction", () => {
    expect(scaleBucket({ x: 0, y: 0, w: 5, h: 5 })).toBe("small"); // 0.25% of frame
    expect(scaleBucket({ x: 0, y: 0, w: 20, h: 20 })).toBe("medium"); // 4%
    expect(scaleBucket({ x: 0, y: 0, w: 50, h: 50 })).toBe("large"); // 25%
  });
});

describe("isTruncated", () => {
  it("detects an object touching any frame edge", () => {
    expect(isTruncated({ x: 0, y: 20, w: 10, h: 10 })).toBe(true); // left edge
    expect(isTruncated({ x: 30, y: 30, w: 10, h: 10 })).toBe(false); // interior
    expect(isTruncated({ x: 60, y: 60, w: 40, h: 40 })).toBe(true); // reaches right/bottom (100)
  });
});

describe("countDerived", () => {
  it("counts scale + truncation, skipping excluded/no-bbox", () => {
    const anns = [
      ann({ x: 40, y: 40, w: 5, h: 5 }),        // small, full
      ann({ x: 40, y: 40, w: 20, h: 20 }),      // medium, full
      ann({ x: 0, y: 40, w: 60, h: 60 }),       // large, truncated (left edge + reaches bottom)
      ann({ x: 40, y: 40, w: 5, h: 5 }, true),  // excluded -> skipped
      ann(undefined),                            // no bbox -> skipped
    ];
    const d = countDerived(anns);
    expect(d.total).toBe(3);
    expect(d.scale).toEqual({ small: 1, medium: 1, large: 1 });
    expect(d.truncation).toEqual({ full: 2, truncated: 1 });
  });
});
