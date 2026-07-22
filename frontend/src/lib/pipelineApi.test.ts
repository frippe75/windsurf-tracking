import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "./pipelineApi";

type Resp = { ok?: boolean; status?: number; body?: any };

/** Queue of responses returned by successive fetch() calls; also records the calls. */
function mockFetch(responses: Resp[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  global.fetch = vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {} } as any;
  });
  return calls;
}

const noSleep = () => Promise.resolve();

afterEach(() => vi.restoreAllMocks());

describe("pipelineApi request shapes", () => {
  it("getModels / getWarmth unwrap and default to empty", async () => {
    mockFetch([{ body: { models: [{ name: "sam3", capabilities: ["concept-segment"] }] } }]);
    expect(await api.getModels()).toEqual([{ name: "sam3", capabilities: ["concept-segment"] }]);
    mockFetch([{ body: {} }]);
    expect(await api.getWarmth()).toEqual({});
  });

  it("segment posts capability + inputs and returns detections", async () => {
    const calls = mockFetch([{ body: { result: { detections: [{ bbox: [1, 2, 3, 4] }] } } }]);
    const dets = await api.segment({ video_id: "v", time_sec: 3, text: "sail" });
    expect(dets).toEqual([{ bbox: [1, 2, 3, 4] }]);
    expect(calls[0].url).toBe("/pipeline/segment");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({
      capability: "concept-segment",
      inputs: { video_id: "v", time_sec: 3, text: "sail" },
    });
  });

  it("segment throws detail on !ok, and appends fallbackLabel when no detail", async () => {
    mockFetch([{ ok: false, status: 502, body: { detail: "boom" } }]);
    await expect(api.segment({ video_id: "v", time_sec: 0, text: "x" })).rejects.toThrow("boom");
    mockFetch([{ ok: false, status: 500, body: {} }]);
    await expect(api.segment({ video_id: "v", time_sec: 0, text: "x" }, "detecting Sail")).rejects.toThrow(
      "HTTP 500 detecting Sail",
    );
  });

  it("startTraining posts the spec and returns job_id; getTrainingStatus unwraps metrics", async () => {
    const calls = mockFetch([{ body: { job_id: "train-abc", status: "submitted" } }]);
    expect(await api.startTraining({ dataset_url: "https://s3/ds.zip", project_id: "p1", epochs: 10 })).toEqual({
      job_id: "train-abc",
      status: "submitted",
    });
    expect(calls[0].url).toBe("/pipeline/train");
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ dataset_url: "https://s3/ds.zip", project_id: "p1", epochs: 10 });

    mockFetch([{ body: { job_id: "train-abc", status: "succeeded", metrics: { mAP50: 0.9, mAP50_95: 0.6, per_class: [], epochs: 10 } } }]);
    const s = await api.getTrainingStatus("train-abc");
    expect(s.status).toBe("succeeded");
    expect(s.metrics?.mAP50).toBe(0.9);

    mockFetch([{ ok: false, status: 404, body: { detail: "no training job" } }]);
    await expect(api.getTrainingStatus("gone")).rejects.toThrow("no training job");
  });

  it("submitTrack returns {job_id, model}; throws on !ok", async () => {
    const calls = mockFetch([{ body: { job_id: "j1", model: "sam3-video" } }]);
    expect(await api.submitTrack({ video_id: "v", start_frame: 0, end_frame: 9, fps: 30, text: "sail" })).toEqual({
      job_id: "j1",
      model: "sam3-video",
    });
    expect(calls[0].url).toBe("/pipeline/track");
    expect(JSON.parse(calls[0].init!.body as string).capability).toBe("concept-track");
    mockFetch([{ ok: false, status: 400, body: {} }]);
    await expect(api.submitTrack({ video_id: "v", start_frame: 0, end_frame: 1, fps: 30, text: "x" })).rejects.toThrow(
      "track submit HTTP 400",
    );
  });

  it("trackStatus encodes model in the query and throws on !ok", async () => {
    const calls = mockFetch([{ body: { status: "IN_QUEUE" } }]);
    await api.trackStatus("j 1", "sam3/video");
    expect(calls[0].url).toBe("/pipeline/track/j 1?model=sam3%2Fvideo");
    mockFetch([{ ok: false, status: 404, body: {} }]);
    await expect(api.trackStatus("j", "m")).rejects.toThrow("track status HTTP 404");
  });
});

describe("pollTrack", () => {
  it("reports progress then returns the COMPLETED payload", async () => {
    mockFetch([{ body: { status: "IN_QUEUE" } }, { body: { status: "COMPLETED", frames: [], count: 0 } }]);
    const progress: string[] = [];
    const out = await api.pollTrack("j", "m", { sleep: noSleep, onProgress: (s) => progress.push(s), extentFrames: 50 });
    expect(out.status).toBe("COMPLETED");
    expect(progress).toContain("Queued (cold start ~1–4 min)…");
  });

  it("IN_PROGRESS message includes the extent", async () => {
    mockFetch([{ body: { status: "IN_PROGRESS" } }, { body: { status: "COMPLETED" } }]);
    const progress: string[] = [];
    await api.pollTrack("j", "m", { sleep: noSleep, onProgress: (s) => progress.push(s), extentFrames: 77 });
    expect(progress).toContain("Tracking 77 frames…");
  });

  it("throws on FAILED, on worker error, and on timeout", async () => {
    mockFetch([{ body: { status: "FAILED" } }]);
    await expect(api.pollTrack("j", "m", { sleep: noSleep })).rejects.toThrow("SAM3 tracking failed");

    mockFetch([{ body: { error: "ffmpeg failed" } }]);
    await expect(api.pollTrack("j", "m", { sleep: noSleep })).rejects.toThrow("ffmpeg failed");

    mockFetch([{ body: { status: "IN_QUEUE" } }]); // never completes
    await expect(api.pollTrack("j", "m", { sleep: noSleep, maxIterations: 3 })).rejects.toThrow("SAM3 tracking timed out");
  });
});
