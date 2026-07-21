import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/pipelineApi", () => ({
  segment: vi.fn(),
  submitTrack: vi.fn(),
  pollTrack: vi.fn(),
}));
import { segment, submitTrack, pollTrack } from "@/lib/pipelineApi";
import { useSamTool, UseSamToolDeps } from "./useSamTool";

const cls = (id: string, name: string, prompt?: string) => ({ id, name, color: "", colorName: "", conceptPrompt: prompt });

function setup(overrides: Partial<UseSamToolDeps> = {}) {
  const toast = vi.fn();
  const setInstances = vi.fn();
  const setAnnotations = vi.fn();
  const deps: UseSamToolDeps = {
    classes: [cls("cA", "Sail", "windsurf sail")],
    selectedClassId: "cA",
    instances: [],
    setInstances,
    setAnnotations,
    currentFrame: 3,
    videoNativeWidth: 1000,
    videoNativeHeight: 500,
    videoFps: 30,
    toast,
    ...overrides,
  };
  const { result } = renderHook(() => useSamTool(deps));
  return { result, toast, setInstances, setAnnotations };
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).__samVideoId = "vid";
  vi.spyOn(document, "querySelector").mockReturnValue({ videoWidth: 1000, videoHeight: 500, currentTime: 1.5 } as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).__samVideoId;
});

describe("addDetections", () => {
  it("no class selected -> toast + return 0, no state change", () => {
    const { result, toast, setInstances } = setup({ selectedClassId: undefined });
    let n = -1;
    act(() => { n = result.current.addDetections([{ bbox: [0, 0, 10, 10] }]); });
    expect(n).toBe(0);
    expect(toast).toHaveBeenCalledWith({ title: "No class selected", description: "Select a class before adding detections." });
    expect(setInstances).not.toHaveBeenCalled();
  });

  it("commits detections and toasts the count + class + frame", () => {
    const { result, toast, setInstances, setAnnotations } = setup();
    let n = -1;
    act(() => { n = result.current.addDetections([{ bbox: [100, 50, 300, 250] }]); });
    expect(n).toBe(1);
    expect(setInstances).toHaveBeenCalledTimes(1);
    expect(setAnnotations).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Detections added", description: "1 object(s) added to Sail at frame 3" });
    // the setter receives an updater that appends the mapped annotation
    const appended = (setAnnotations.mock.calls[0][0] as any)([]);
    expect(appended[0].bbox).toEqual({ x: 10, y: 10, w: 20, h: 40 });
    expect(appended[0].isKeyframe).toBe(true);
  });

  it("all-invalid detections -> return 0, no toast/state", () => {
    const { result, toast, setInstances } = setup();
    let n = -1;
    act(() => { n = result.current.addDetections([{ bbox: [1, 2] }]); });
    expect(n).toBe(0);
    expect(setInstances).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("detectAllClasses", () => {
  it("runs each class's prompt, files results, final toast", async () => {
    (segment as any).mockResolvedValue([{ bbox: [0, 0, 100, 100], score: 0.9 }]);
    const { result, toast } = setup({
      classes: [cls("cA", "Sail", "windsurf sail"), cls("cB", "Board", "surfboard")],
      selectedClassId: "cA",
    });
    let total = -1;
    await act(async () => { total = await result.current.detectAllClasses(0.5); });
    expect(segment).toHaveBeenCalledTimes(2);
    expect(segment).toHaveBeenCalledWith({ video_id: "vid", time_sec: 1.5, text: "windsurf sail" }, "detecting Sail");
    expect(total).toBe(2); // 1 per class
    expect(toast).toHaveBeenCalledWith({ title: "Detect all complete", description: "2 object(s) across 2 class(es)" });
  });

  it("throws when no video frame is showing", async () => {
    (document.querySelector as any).mockReturnValue(null);
    const { result } = setup();
    await expect(result.current.detectAllClasses(0.5)).rejects.toThrow("Load a video first");
  });

  it("respects minScore filtering", async () => {
    (segment as any).mockResolvedValue([{ bbox: [0, 0, 10, 10], score: 0.2 }]);
    const { result } = setup();
    let total = -1;
    await act(async () => { total = await result.current.detectAllClasses(0.5); });
    expect(total).toBe(0); // 0.2 < 0.5 -> filtered out
  });
});

describe("track", () => {
  it("no class selected -> toast + return 0", async () => {
    const { result, toast } = setup({ selectedClassId: undefined });
    let n = -1;
    await act(async () => { n = await result.current.track("sail", 50); });
    expect(n).toBe(0);
    expect(toast).toHaveBeenCalledWith({ title: "No class selected", description: "Select a class before tracking." });
    expect(submitTrack).not.toHaveBeenCalled();
  });

  it("submits the window, ingests frames, toasts completion", async () => {
    (submitTrack as any).mockResolvedValue({ job_id: "j1", model: "sam3-video" });
    (pollTrack as any).mockResolvedValue({
      frames: [{ frame_number: 0, objects: [{ object_id: 0, bbox_pct: [10, 10, 30, 30] }] }],
    });
    const { result, toast, setAnnotations } = setup();
    const progress: string[] = [];
    let n = -1;
    await act(async () => { n = await result.current.track("sail", 50, (s) => progress.push(s)); });
    // start=currentFrame(3), end=3+50-1=52
    expect(submitTrack).toHaveBeenCalledWith({ video_id: "vid", start_frame: 3, end_frame: 52, fps: 30, text: "sail" });
    expect(progress).toContain("Submitting…");
    expect(n).toBe(1);
    expect(setAnnotations).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Tracking complete", description: "1 object(s) tracked across 1 frames" });
  });
});
