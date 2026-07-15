import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { VideoPlayer } from "./VideoPlayer";

// jsdom lacks ResizeObserver / canvas 2D context; stub both.
beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
    clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
    scale: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fillText: vi.fn(), measureText: vi.fn(() => ({ width: 0 })),
  }));
});
afterEach(() => cleanup());

function renderPlayer(onCanvasClick = vi.fn(), tool = "annotate" as const) {
  const noop = () => {};
  const { container } = render(
    <VideoPlayer
      videoUrl="blob:test"
      currentFrame={0}
      totalFrames={100}
      frameRange={[0, 100]}
      onFrameChange={noop}
      onCanvasClick={onCanvasClick}
      classes={[]}
      instances={[]}
      annotations={[]}
      onAnnotationUpdate={noop}
      overlays={{ segments: true, bboxes: true, points: true }}
      selectedTool={tool}
      onContextMenu={noop}
    />
  );
  return { container, onCanvasClick };
}

describe("VideoPlayer touch tap (mobile prompt placement)", () => {
  it("a touch pointerup (tap) dispatches onCanvasClick", () => {
    const { container, onCanvasClick } = renderPlayer();
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerType: "touch", clientX: 101, clientY: 101 });
    expect(onCanvasClick).toHaveBeenCalledTimes(1);
    // touch → no keyboard modifiers (Index resolves type from the tap toggle)
    const args = onCanvasClick.mock.calls[0];
    expect(args[4]).toBe(false); // ctrlKey
    expect(args[5]).toBe(false); // altKey
  });

  it("a touch drag (moved far) does NOT place a prompt", () => {
    const { container, onCanvasClick } = renderPlayer();
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerType: "touch", clientX: 160, clientY: 160 });
    expect(onCanvasClick).not.toHaveBeenCalled();
  });

  it("the touch tap swallows the synthesized mouse click (no double placement)", () => {
    const { container, onCanvasClick } = renderPlayer();
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 100, clientY: 100 }); // synthesized after touch
    expect(onCanvasClick).toHaveBeenCalledTimes(1);
  });

  it("a real mouse click still places a prompt", () => {
    const { container, onCanvasClick } = renderPlayer();
    const canvas = container.querySelector("canvas")!;
    fireEvent.click(canvas, { clientX: 50, clientY: 50, ctrlKey: true });
    expect(onCanvasClick).toHaveBeenCalledTimes(1);
    expect(onCanvasClick.mock.calls[0][4]).toBe(true); // ctrlKey passed through
  });
});

import fs from "node:fs";
import path from "node:path";

describe("VideoPlayer canvas sizing (regression: 1×1 canvas on mobile)", () => {
  it("the draw effect depends on containerSize and videoDims", () => {
    // The canvas bitmap is sized inside drawAnnotations from the displayed rect.
    // If the draw effect doesn't re-run when the container/video size changes,
    // the canvas stays 1×1 (first draw at 0×0) and every tap maps to the corner.
    const src = fs.readFileSync(
      path.join(__dirname, "VideoPlayer.tsx"),
      "utf8",
    );
    // The effect that calls drawAnnotations must list containerSize + videoDims.
    const effectDeps = src.match(/drawAnnotations\(\);[\s\S]*?\}, \[([^\]]*)\]/);
    expect(effectDeps).not.toBeNull();
    expect(effectDeps![1]).toContain("containerSize");
    expect(effectDeps![1]).toContain("videoDims");
  });
});
