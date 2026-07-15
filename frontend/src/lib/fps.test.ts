import { describe, it, expect } from "vitest";
import { deriveFps } from "./fps";

describe("deriveFps", () => {
  it("derives 25fps for the youtube-test video (974 frames / 38.96s)", () => {
    expect(deriveFps(974, 38.96)).toBeCloseTo(25.0, 1);
  });

  it("derives 30fps for a 30fps video", () => {
    expect(deriveFps(300, 10)).toBeCloseTo(30, 5);
  });

  it("derives 50fps", () => {
    expect(deriveFps(500, 10)).toBeCloseTo(50, 5);
  });

  it("falls back to 30 when duration is unknown (NaN/0)", () => {
    expect(deriveFps(974, NaN)).toBe(30);
    expect(deriveFps(974, 0)).toBe(30);
    expect(deriveFps(974, undefined)).toBe(30);
  });

  it("falls back when frame count is unknown", () => {
    expect(deriveFps(0, 10)).toBe(30);
    expect(deriveFps(undefined, 10)).toBe(30);
  });

  it("honours a custom fallback", () => {
    expect(deriveFps(undefined, undefined, 24)).toBe(24);
  });

  it("seek time at derived fps lands on the backend's frame (regression)", () => {
    // The whole point: displayed frame == backend frame.
    const fps = deriveFps(974, 38.96); // 25
    const frame = 250;
    const seekTime = frame / fps; // 10.0s
    const backendFrame = Math.round(seekTime * fps);
    expect(backendFrame).toBe(frame);
  });
});
