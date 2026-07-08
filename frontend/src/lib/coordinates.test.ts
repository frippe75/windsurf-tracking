import { describe, it, expect } from "vitest";
import { pctToNative, nativeBBoxToPct, bboxToPolygon, isMaskCropped } from "./coordinates";

describe("pctToNative", () => {
  it("maps center click to center pixel", () => {
    expect(pctToNative(50, 50, 1920, 1080)).toEqual({ x: 960, y: 540 });
  });

  it("maps corners", () => {
    expect(pctToNative(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0 });
    expect(pctToNative(100, 100, 1920, 1080)).toEqual({ x: 1920, y: 1080 });
  });

  it("rounds to whole pixels", () => {
    // 33.333% of 1000 = 333.33 → 333
    expect(pctToNative(33.333, 66.666, 1000, 1000)).toEqual({ x: 333, y: 667 });
  });

  it("scales x and y independently on non-16:9 video", () => {
    // 4:3 video — a common failure mode is assuming a single scale factor
    expect(pctToNative(50, 50, 640, 480)).toEqual({ x: 320, y: 240 });
    expect(pctToNative(25, 75, 640, 480)).toEqual({ x: 160, y: 360 });
  });
});

describe("nativeBBoxToPct", () => {
  it("converts a native corner bbox to percent x/y/w/h", () => {
    const bbox = nativeBBoxToPct([192, 108, 960, 540], 1920, 1080);
    expect(bbox.x).toBeCloseTo(10);
    expect(bbox.y).toBeCloseTo(10);
    expect(bbox.w).toBeCloseTo(40);
    expect(bbox.h).toBeCloseTo(40);
  });

  it("full-frame bbox is 0,0,100,100", () => {
    expect(nativeBBoxToPct([0, 0, 640, 360], 640, 360)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("round-trips with pctToNative", () => {
    const [w, h] = [1280, 720];
    const bbox = nativeBBoxToPct([100, 50, 500, 300], w, h);
    const topLeft = pctToNative(bbox.x, bbox.y, w, h);
    expect(topLeft).toEqual({ x: 100, y: 50 });
  });

  it("uses independent axes on portrait video", () => {
    const bbox = nativeBBoxToPct([0, 0, 360, 640], 720, 1280);
    expect(bbox.w).toBeCloseTo(50);
    expect(bbox.h).toBeCloseTo(50);
  });
});

describe("bboxToPolygon", () => {
  it("produces 4 clockwise corners from top-left", () => {
    expect(bboxToPolygon({ x: 10, y: 20, w: 30, h: 40 })).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });
});

describe("isMaskCropped", () => {
  it("full-frame mask (matching native dims) is not cropped", () => {
    expect(isMaskCropped(1920, 1080, 1920, 1080)).toBe(false);
  });

  it("mask smaller than native is cropped", () => {
    expect(isMaskCropped(400, 300, 1920, 1080)).toBe(true);
  });

  it("letterboxed 1280x720 mask on non-16:9 native is flagged cropped", () => {
    // Known trap: batch-pipeline masks are letterboxed to 1280x720
    expect(isMaskCropped(1280, 720, 640, 480)).toBe(true);
  });

  it("unknown mask dims are treated as full-frame", () => {
    expect(isMaskCropped(undefined, undefined, 1920, 1080)).toBe(false);
    expect(isMaskCropped(100, undefined, 1920, 1080)).toBe(false);
  });

  it("unknown native dims are treated as full-frame", () => {
    expect(isMaskCropped(1280, 720, 0, 0)).toBe(false);
  });
});
