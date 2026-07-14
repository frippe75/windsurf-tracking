import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { VideoListItem } from "./VideoListItem";
import type { ManagedVideo } from "@/types/video";

// Controllable IntersectionObserver
let ioCb: (entries: any[]) => void = () => {};
beforeEach(() => {
  (globalThis as any).IntersectionObserver = class {
    constructor(cb: any) { ioCb = cb; }
    observe() {}
    disconnect() {}
  };
});
afterEach(() => cleanup());

const ready: ManagedVideo = {
  id: "vid-1", filename: "clip.mp4", status: "ready",
  metadata: { duration: 10, fps: 30, width: 1280, height: 720, totalFrames: 300 },
  isActive: false, createdAt: 1, lastAccessedAt: 1,
};

describe("VideoListItem thumbnail (used by ProjectManager_v2)", () => {
  it("renders the backend frame thumbnail once in view", () => {
    const { container } = render(<VideoListItem video={ready} showThumbnail />);
    // not loaded until in view
    expect(container.querySelector("img")).toBeNull();
    act(() => ioCb([{ isIntersecting: true }]));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("/api/videos/vid-1/frame/0");
  });

  it("shows a placeholder icon (no img) for non-ready videos", () => {
    const { container } = render(
      <VideoListItem video={{ ...ready, status: "downloading", metadata: undefined }} showThumbnail />
    );
    act(() => ioCb([{ isIntersecting: true }]));
    expect(container.querySelector("img")).toBeNull();
  });
});
