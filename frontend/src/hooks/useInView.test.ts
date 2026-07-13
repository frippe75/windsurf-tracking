import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInView } from "./useInView";

/**
 * Controllable IntersectionObserver mock: records every constructed instance so
 * a test can drive intersection callbacks deterministically.
 */
interface MockIO {
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  fire: (isIntersecting: boolean) => void;
}

let instances: MockIO[] = [];

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    instances.push({
      callback,
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

beforeEach(() => {
  instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useInView", () => {
  it("starts not-in-view and observes the attached element", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => {
      const io = useInView<HTMLDivElement>();
      // Set during render so the effect (run after render) sees the element.
      (io.ref as { current: HTMLDivElement | null }).current = el;
      return io;
    });
    expect(result.current.inView).toBe(false);
    expect(instances.length).toBe(1);
    expect(instances[0].observe).toHaveBeenCalledWith(el);
  });

  it("becomes in-view when the observer reports intersection", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => {
      const io = useInView<HTMLDivElement>();
      (io.ref as { current: HTMLDivElement | null }).current = el;
      return io;
    });

    expect(result.current.inView).toBe(false);
    expect(instances.length).toBe(1);

    act(() => instances[0].fire(true));
    expect(result.current.inView).toBe(true);
    // once=true (default): observer is disconnected after first intersection.
    expect(instances[0].disconnect).toHaveBeenCalled();
  });

  it("degrades to visible when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const el = document.createElement("div");
    const { result } = renderHook(() => {
      const io = useInView<HTMLDivElement>();
      (io.ref as { current: HTMLDivElement | null }).current = el;
      return io;
    });
    expect(result.current.inView).toBe(true);
  });
});
