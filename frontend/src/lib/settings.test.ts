import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadSettings,
  saveSettings,
  updateSettings,
  resetSettings,
  getBackendSettings,
  saveBackendSettings,
  getToolPreferences,
  saveToolPreferences,
  type AppSettings,
} from "./settings";

const KEY = "app-settings-v1";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("loadSettings", () => {
  it("returns defaults when nothing is stored", () => {
    const s = loadSettings();
    expect(s.selectedBackendId).toBeNull();
    expect(s.autoTrack).toBe(true);
    expect(s.useSAM2).toBe(true);
    expect(s.overlays).toEqual({ segments: true, bboxes: true, points: true });
    expect(s.customBackends).toEqual([]);
    expect(s.shortcuts.togglePlay).toBe("Space");
  });

  it("merges stored partial over defaults (forward-compatible with new keys)", () => {
    // Simulate an older payload missing newer keys like `overlays` / `shortcuts`.
    localStorage.setItem(KEY, JSON.stringify({ autoTrack: false, selectedBackendId: "b1" }));
    const s = loadSettings();
    expect(s.autoTrack).toBe(false); // stored value wins
    expect(s.selectedBackendId).toBe("b1");
    expect(s.overlays).toEqual({ segments: true, bboxes: true, points: true }); // default filled in
    expect(s.maximizeVideo).toBe(false);
  });

  it("falls back to defaults on corrupt JSON without throwing", () => {
    localStorage.setItem(KEY, "{not-valid-json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = loadSettings();
    expect(s.autoDetect).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("saveSettings / roundtrip", () => {
  it("persists to localStorage and loads back identically", () => {
    const custom: AppSettings = {
      ...loadSettings(),
      autoTrack: false,
      selectedBackendId: "gpu-1",
      customBackends: [{ id: "x", name: "X", url: "http://x", enableProbe: true }],
    };
    saveSettings(custom);
    expect(JSON.parse(localStorage.getItem(KEY)!).selectedBackendId).toBe("gpu-1");
    expect(loadSettings()).toEqual(custom);
  });

  it("swallows storage write errors (does not throw)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => saveSettings(loadSettings())).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    setSpy.mockRestore();
  });
});

describe("updateSettings", () => {
  it("merges a partial into current settings and persists the result", () => {
    saveSettings({ ...loadSettings(), autoDetect: false });
    const updated = updateSettings({ showLabels: false });
    expect(updated.autoDetect).toBe(false); // preserved from prior state
    expect(updated.showLabels).toBe(false); // applied
    expect(loadSettings().showLabels).toBe(false); // persisted
  });

  it("does a shallow merge (replaces nested objects wholesale)", () => {
    const updated = updateSettings({ overlays: { segments: false, bboxes: false, points: false } });
    expect(updated.overlays).toEqual({ segments: false, bboxes: false, points: false });
  });
});

describe("resetSettings", () => {
  it("overwrites stored settings back to defaults", () => {
    saveSettings({ ...loadSettings(), autoTrack: false, maximizeVideo: true });
    const d = resetSettings();
    expect(d.autoTrack).toBe(true);
    expect(d.maximizeVideo).toBe(false);
    expect(loadSettings().autoTrack).toBe(true);
  });
});

describe("backend helpers", () => {
  it("getBackendSettings returns only the backend slice", () => {
    saveBackendSettings({ selectedBackendId: "b9", customBackends: [{ id: "c", name: "C", url: "http://c" }] });
    const b = getBackendSettings();
    expect(b.selectedBackendId).toBe("b9");
    expect(b.customBackends).toEqual([{ id: "c", name: "C", url: "http://c" }]);
    expect(b).not.toHaveProperty("autoTrack");
  });

  it("saveBackendSettings persists without clobbering unrelated tool prefs", () => {
    saveToolPreferences({ autoDetect: false });
    saveBackendSettings({ selectedBackendId: "keep" });
    const s = loadSettings();
    expect(s.selectedBackendId).toBe("keep");
    expect(s.autoDetect).toBe(false);
  });
});

describe("tool preference helpers", () => {
  it("getToolPreferences returns only the tool slice", () => {
    const p = getToolPreferences();
    expect(p).toEqual({
      autoTrack: true,
      autoDetect: true,
      useSAM2: true,
      showLabels: true,
      overlays: { segments: true, bboxes: true, points: true },
      maximizeVideo: false,
    });
    expect(p).not.toHaveProperty("customBackends");
  });

  it("saveToolPreferences merges and persists", () => {
    saveToolPreferences({ useSAM2: false, maximizeVideo: true });
    const p = getToolPreferences();
    expect(p.useSAM2).toBe(false);
    expect(p.maximizeVideo).toBe(true);
    expect(p.autoTrack).toBe(true); // untouched
  });
});
