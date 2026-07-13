import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { LazyThumbnail } from "./LazyThumbnail";

/**
 * Controllable IntersectionObserver mock so tests can decide exactly when an
 * element is reported as visible.
 */
interface MockIO {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  fire: (isIntersecting: boolean) => void;
}

let instances: MockIO[] = [];

class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];

  constructor(callback: IntersectionObserverCallback) {
    instances.push({
      observe: this.observe,
      disconnect: this.disconnect,
      fire: (isIntersecting: boolean) =>
        callback(
          [{ isIntersecting } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
    });
  }
}

const BACKEND_URL =
  "http://backend.test/api/videos/vid1/frame/0?width=160&height=112";

beforeEach(() => {
  instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LazyThumbnail", () => {
  it("does NOT set the backend src until the element is reported in-view", () => {
    render(<LazyThumbnail src={BACKEND_URL} alt="clip.mp4" />);

    // Before intersection: no <img>, therefore no backend request fired.
    expect(screen.queryByRole("img")).toBeNull();
    expect(instances.length).toBe(1);

    // Simulate the item scrolling into view.
    act(() => instances[0].fire(true));

    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(BACKEND_URL);
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("renders N items WITHOUT eagerly producing N backend requests", () => {
    const urls = Array.from(
      { length: 70 },
      (_, i) => `http://backend.test/api/videos/v${i}/frame/0?width=160&height=112`,
    );

    render(
      <>
        {urls.map((url, i) => (
          <LazyThumbnail key={i} src={url} alt={`v${i}`} />
        ))}
      </>,
    );

    // 70 items mounted, 70 observers created, but ZERO <img> (zero backend hits)
    // until anything actually intersects — this is the thundering-herd fix.
    expect(instances.length).toBe(70);
    expect(document.querySelectorAll("img").length).toBe(0);

    // Only the first item scrolls into view -> exactly one image requested.
    act(() => instances[0].fire(true));
    const imgs = Array.from(document.querySelectorAll("img"));
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute("src")).toBe(urls[0]);
  });
});
