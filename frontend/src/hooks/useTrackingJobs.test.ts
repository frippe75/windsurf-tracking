import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTrackingJobs, type UseTrackingJobsOptions, type TrackingApi } from "./useTrackingJobs";
import { Annotation, Keyframe } from "@/types/annotation";
import type { CreateTrackingJobResponse, TrackingJobStatus, TrackingJobResults } from "@/lib/api";

function makeAnnotation(id: string, frame = 0, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    instanceId: `inst-${id}`,
    frameCreated: frame,
    points: [],
    isKeyframe: true,
    sam2Prompts: [{ x: 50, y: 50, type: "positive" }],
    ...overrides,
  };
}

function makeKeyframe(frame: number, type: Keyframe["type"]): Keyframe {
  return { frame, type, timestamp: "t" };
}

function singleJobResponse(jobId = "backend-job-1"): CreateTrackingJobResponse {
  return {
    job_id: "parent",
    single_job: {
      video_id: "v1",
      video_path: "/videos/v1.mp4",
      fps: 30,
      job_id: jobId,
      name: "Full Segment",
      start_frame: 0,
      end_frame: 10,
      frames: 10,
      click_prompts: [],
      estimated_memory: "5.2GB",
      status: "pending",
    },
  };
}

function statusResponse(status: TrackingJobStatus["status"], percentage = 0): TrackingJobStatus {
  return { job_id: "backend-job-1", status, percentage };
}

function resultsResponse(): TrackingJobResults {
  return {
    job_id: "backend-job-1",
    video_id: "v1",
    start_frame: 0,
    end_frame: 10,
    results: [
      // Start-frame result is always skipped (manual keyframe already exists)
      { frame_number: 0, bbox: [0, 0, 100, 100], score: 0.9 },
      // 1280x720 native: [64, 36, 128, 72] -> 5% / 5% origin, 5% x 5% size
      { frame_number: 1, bbox: [64, 36, 128, 72], score: 0.95 },
    ],
  };
}

function makeApi(overrides: Partial<TrackingApi> = {}): TrackingApi {
  return {
    createTrackingJob: vi.fn().mockResolvedValue(singleJobResponse()),
    executeTrackingJob: vi.fn().mockResolvedValue({ job_id: "backend-job-1", status: "started" }),
    getTrackingJobStatus: vi.fn().mockResolvedValue(statusResponse("completed", 100)),
    getTrackingJobResults: vi.fn().mockResolvedValue(resultsResponse()),
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseTrackingJobsOptions> = {}): UseTrackingJobsOptions {
  return {
    videoId: "v1",
    videoNativeWidth: 1280,
    videoNativeHeight: 720,
    annotations: [],
    keyframes: [],
    setAnnotations: vi.fn(),
    toast: vi.fn(),
    api: makeApi(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTrackingJobs auto-created jobs", () => {
  it("creates a pending job per START->STOP pair with segment annotations", () => {
    const { result } = renderHook(() =>
      useTrackingJobs(
        makeOptions({
          keyframes: [makeKeyframe(0, "START"), makeKeyframe(10, "STOP")],
          annotations: [makeAnnotation("a1", 0), makeAnnotation("outside", 50)],
        })
      )
    );

    expect(result.current.trackingJobs).toHaveLength(1);
    expect(result.current.trackingJobs[0]).toMatchObject({
      id: "segment-0-10",
      startFrame: 0,
      stopFrame: 10,
      objectIds: ["a1"],
      status: "pending",
    });
  });

  it("removes pending jobs when the START->STOP pair disappears", () => {
    const { result, rerender } = renderHook(
      ({ keyframes }: { keyframes: Keyframe[] }) =>
        useTrackingJobs(makeOptions({ keyframes, annotations: [makeAnnotation("a1", 0)] })),
      { initialProps: { keyframes: [makeKeyframe(0, "START"), makeKeyframe(10, "STOP")] } }
    );

    expect(result.current.trackingJobs).toHaveLength(1);

    rerender({ keyframes: [makeKeyframe(0, "START")] });

    expect(result.current.trackingJobs).toHaveLength(0);
  });
});

describe("useTrackingJobs handleStartTracking", () => {
  it("creates a job from the annotation frame to the next STOP keyframe", () => {
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useTrackingJobs(
        makeOptions({
          toast,
          annotations: [makeAnnotation("a1", 5)],
          keyframes: [makeKeyframe(20, "STOP")],
        })
      )
    );

    act(() => result.current.handleStartTracking("a1"));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Tracking job created",
        description: "Frames 5 → 20",
      })
    );
    // Preserved quirk from Index.tsx: the auto-create effect prunes pending
    // jobs whose id does not match a START->STOP segment, so manually
    // started `job-<ts>` entries are removed on the very next render.
    expect(result.current.trackingJobs).toHaveLength(0);
  });

  it("warns when no STOP keyframe follows the annotation", () => {
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useTrackingJobs(makeOptions({ toast, annotations: [makeAnnotation("a1", 5)] }))
    );

    act(() => result.current.handleStartTracking("a1"));

    expect(result.current.trackingJobs).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No STOP keyframe found" })
    );
  });
});

describe("useTrackingJobs handleProcessJob lifecycle", () => {
  const baseOptions = () => ({
    keyframes: [makeKeyframe(0, "START"), makeKeyframe(10, "STOP")],
    annotations: [makeAnnotation("a1", 0)],
  });

  it("runs pending -> processing -> completed and ingests results as pct annotations", async () => {
    vi.useFakeTimers();
    const api = makeApi({
      getTrackingJobStatus: vi
        .fn()
        .mockResolvedValueOnce(statusResponse("running", 50))
        .mockResolvedValueOnce(statusResponse("completed", 100)),
    });
    const setAnnotations = vi.fn();
    const { result } = renderHook(() =>
      useTrackingJobs(makeOptions({ ...baseOptions(), api, setAnnotations }))
    );

    expect(result.current.trackingJobs[0].status).toBe("pending");

    await act(async () => {
      const processing = result.current.handleProcessJob("segment-0-10");
      await vi.advanceTimersByTimeAsync(3_000);
      await processing;
    });

    // Job creation used native click prompts (50% of 1280x720 = 640,360)
    expect(api.createTrackingJob).toHaveBeenCalledWith("v1", [
      { start_frame: 0, end_frame: 10, click_prompts: [{ x: 640, y: 360, type: "positive" }] },
    ]);
    expect(api.executeTrackingJob).toHaveBeenCalledWith("backend-job-1");
    expect(api.getTrackingJobStatus).toHaveBeenCalledTimes(2);

    // Final job state
    expect(result.current.trackingJobs[0].status).toBe("completed");
    expect(result.current.trackingJobs[0].progress).toBe(100);
    expect(result.current.trackingJobs[0].subJobs?.[0].status).toBe("completed");

    // Result ingestion: start frame skipped, native bbox converted to pct
    expect(setAnnotations).toHaveBeenCalledTimes(1);
    const updater = vi.mocked(setAnnotations).mock.calls[0][0] as (prev: Annotation[]) => Annotation[];
    const ingested = updater([]);
    expect(ingested).toHaveLength(1);
    expect(ingested[0].frameCreated).toBe(1);
    expect(ingested[0].bbox).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(ingested[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
    ]);
    expect(ingested[0].instanceId).toBe("inst-a1");
    expect(ingested[0].isKeyframe).toBe(false);
  });

  it("stops polling and marks the job failed when the backend reports failure", async () => {
    vi.useFakeTimers();
    const toast = vi.fn();
    const api = makeApi({
      getTrackingJobStatus: vi.fn().mockResolvedValue(statusResponse("failed")),
    });
    const setAnnotations = vi.fn();
    const { result } = renderHook(() =>
      useTrackingJobs(makeOptions({ ...baseOptions(), api, setAnnotations, toast }))
    );

    await act(async () => {
      const processing = result.current.handleProcessJob("segment-0-10");
      await vi.advanceTimersByTimeAsync(1_000);
      await processing;
    });

    expect(result.current.trackingJobs[0].status).toBe("failed");
    expect(api.getTrackingJobStatus).toHaveBeenCalledTimes(1);
    expect(api.getTrackingJobResults).not.toHaveBeenCalled();
    expect(setAnnotations).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tracking failed", variant: "destructive" })
    );

    // Polling has stopped: more time does not trigger further status calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.getTrackingJobStatus).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the job completes", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const { result } = renderHook(() => useTrackingJobs(makeOptions({ ...baseOptions(), api })));

    await act(async () => {
      const processing = result.current.handleProcessJob("segment-0-10");
      await vi.advanceTimersByTimeAsync(1_000);
      await processing;
    });

    expect(api.getTrackingJobStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.getTrackingJobStatus).toHaveBeenCalledTimes(1);
  });

  it("refuses to process a segment without SAM2 prompts", async () => {
    const toast = vi.fn();
    const api = makeApi();
    const { result } = renderHook(() =>
      useTrackingJobs(
        makeOptions({
          toast,
          api,
          keyframes: [makeKeyframe(0, "START"), makeKeyframe(10, "STOP")],
          annotations: [makeAnnotation("a1", 0, { sam2Prompts: undefined })],
        })
      )
    );

    await act(async () => {
      await result.current.handleProcessJob("segment-0-10");
    });

    expect(api.createTrackingJob).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No prompts found", variant: "destructive" })
    );
  });
});

describe("useTrackingJobs handleDeleteJob", () => {
  it("removes the job (auto-created pending jobs are re-created while the pair exists — preserved quirk)", async () => {
    const toast = vi.fn();
    const { result, rerender } = renderHook(
      ({ keyframes }: { keyframes: Keyframe[] }) =>
        useTrackingJobs(makeOptions({ toast, keyframes, annotations: [makeAnnotation("a1", 0)] })),
      { initialProps: { keyframes: [makeKeyframe(0, "START"), makeKeyframe(10, "STOP")] } }
    );
    expect(result.current.trackingJobs).toHaveLength(1);

    act(() => result.current.handleDeleteJob("segment-0-10"));
    expect(toast).toHaveBeenCalledWith({ title: "Job deleted" });
    // Preserved quirk from Index.tsx: while the START->STOP pair still
    // exists, the auto-create effect immediately re-creates the pending job.
    await waitFor(() => expect(result.current.trackingJobs).toHaveLength(1));

    // Once the pair is gone, deletion sticks.
    rerender({ keyframes: [] });
    expect(result.current.trackingJobs).toHaveLength(0);
  });
});
