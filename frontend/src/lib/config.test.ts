import { describe, it, expect, afterEach } from "vitest";
import { config } from "./config";

const OVERRIDE = "__LOVABLE_BACKEND_URL__";
const win = window as unknown as Record<string, string | undefined>;

afterEach(() => {
  delete win[OVERRIDE];
});

describe("config.useMockApi", () => {
  it("is false unless VITE_USE_MOCK_API is exactly 'true' (undefined in tests)", () => {
    // The test env does not set VITE_USE_MOCK_API, so real endpoints are used.
    expect(config.useMockApi).toBe(false);
  });
});

describe("config.backendUrl getter", () => {
  it("falls back to the localhost dev default when no runtime override is set", () => {
    delete win[OVERRIDE];
    expect(config.backendUrl).toBe("http://localhost:8000");
  });

  it("returns the runtime override set by the BackendSelector when present", () => {
    win[OVERRIDE] = "https://gpu-worker.example";
    expect(config.backendUrl).toBe("https://gpu-worker.example");
  });

  it("is a live getter: reflects override changes on each access", () => {
    expect(config.backendUrl).toBe("http://localhost:8000");
    win[OVERRIDE] = "https://switched.example";
    expect(config.backendUrl).toBe("https://switched.example");
    delete win[OVERRIDE];
    expect(config.backendUrl).toBe("http://localhost:8000");
  });
});
