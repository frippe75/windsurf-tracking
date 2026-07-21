/**
 * Typed client for the pipeline_service (same-origin `/pipeline`). This is the ONLY place
 * `/pipeline` URLs live — components/hooks call these functions, not raw fetch, so the API
 * boundary is mockable and the FE can be refactored along a clean seam.
 *
 * Behavior (URLs, bodies, error strings, poll semantics) is preserved EXACTLY from the previous
 * inline fetches in SamTool.tsx / Index.tsx.
 */
const PIPELINE = "/pipeline";

export type ModelInfo = { name: string; capabilities: string[] };
export type Warm = { serverless?: boolean; status?: string; warm?: boolean };
export type Point = { x: number; y: number };
export type Detection = { bbox: number[]; score?: number; polygon?: Point[] };
export type SegmentInput = { video_id: string; time_sec: number; text: string };
export type TrackSubmitInput = { video_id: string; start_frame: number; end_frame: number; fps: number; text: string };
export type TrackSubmit = { job_id: string; model: string };
export type TrackObject = { object_id?: number; bbox_pct?: number[]; polygon?: Point[]; score?: number };
export type TrackFrame = { frame_number: number; objects?: TrackObject[] };
export type TrackStatus = { status?: string; error?: string; frames?: TrackFrame[]; count?: number };

const jparse = (r: Response): Promise<any> => r.json().catch(() => ({}));

export async function getModels(): Promise<ModelInfo[]> {
  const r = await fetch(`${PIPELINE}/models`);
  return (await jparse(r)).models || [];
}

export async function getWarmth(): Promise<Record<string, Warm>> {
  const r = await fetch(`${PIPELINE}/warmth`);
  return (await jparse(r)).warmth || {};
}

/** Concept segmentation on one frame. `fallbackLabel` appends to the HTTP-n fallback (used by
 * detect-all to preserve the "…detecting <class>" message when the server sends no detail). */
export async function segment(input: SegmentInput, fallbackLabel?: string): Promise<Detection[]> {
  const r = await fetch(`${PIPELINE}/segment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "concept-segment", inputs: input }),
  });
  const d = await jparse(r);
  if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}${fallbackLabel ? ` ${fallbackLabel}` : ""}`);
  return d.result?.detections ?? [];
}

export async function submitTrack(input: TrackSubmitInput): Promise<TrackSubmit> {
  const r = await fetch(`${PIPELINE}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "concept-track", inputs: input }),
  });
  const d = await jparse(r);
  if (!r.ok) throw new Error(d.detail || `track submit HTTP ${r.status}`);
  return { job_id: d.job_id, model: d.model };
}

export async function trackStatus(jobId: string, model: string): Promise<TrackStatus> {
  const r = await fetch(`${PIPELINE}/track/${jobId}?model=${encodeURIComponent(model)}`);
  const d = await jparse(r);
  if (!r.ok) throw new Error(d.detail || `track status HTTP ${r.status}`);
  return d;
}

const defaultSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export interface PollOpts {
  onProgress?: (s: string) => void;
  extentFrames?: number;        // for the "Tracking N frames…" message
  sleep?: (ms: number) => Promise<void>;  // injectable for tests (no real timers)
  intervalMs?: number;
  maxIterations?: number;
}

/** Poll a tracking job to completion. Sleeps BEFORE each poll (matching the original), 180×2s by
 * default (~6 min ceiling). Throws on FAILED, on a worker `error`, or on timeout. */
export async function pollTrack(jobId: string, model: string, opts: PollOpts = {}): Promise<TrackStatus> {
  const sleep = opts.sleep ?? defaultSleep;
  const interval = opts.intervalMs ?? 2000;
  const max = opts.maxIterations ?? 180;
  for (let i = 0; i < max; i++) {
    await sleep(interval);
    const sd = await trackStatus(jobId, model); // throws on !ok
    if (sd.error) throw new Error(String(sd.error));
    if (sd.status === "IN_QUEUE") opts.onProgress?.("Queued (cold start ~1–4 min)…");
    else if (sd.status === "IN_PROGRESS") opts.onProgress?.(`Tracking ${opts.extentFrames ?? ""} frames…`);
    if (sd.status === "COMPLETED") return sd;
    if (sd.status === "FAILED") throw new Error("SAM3 tracking failed");
  }
  throw new Error("SAM3 tracking timed out");
}
