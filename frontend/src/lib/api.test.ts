import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "./api";

// The test env leaves VITE_USE_MOCK_API unset, so config.useMockApi === false and
// every call below exercises the REAL fetch path against the localhost dev default.
const BASE = "http://localhost:8000";

type Resp = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

interface Call {
  url: string;
  method?: string;
  headers: Record<string, unknown>;
  body?: unknown;
}

/** Queue of responses returned by successive fetch() calls; records request shape. */
function mockFetch(responses: Resp[]) {
  const calls: Call[] = [];
  let i = 0;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, unknown>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.statusText ?? "",
      json: async () => r.body ?? {},
      text: async () => r.text ?? "",
      headers: { get: (k: string) => r.headers?.[k] ?? null },
    } as unknown as Response;
  });
  return calls;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("checkBackendHealth", () => {
  it("probes /api/ai/status and reports healthy on ok", async () => {
    const calls = mockFetch([{ body: { ok: true } }]);
    const h = await api.checkBackendHealth("http://custom:9000");
    expect(h).toEqual({ message: "Windsurf Dataset API", version: "2.0.0", status: "healthy" });
    expect(calls[0].url).toBe("http://custom:9000/api/ai/status");
  });

  it("returns null on a non-ok response", async () => {
    mockFetch([{ ok: false, status: 503 }]);
    expect(await api.checkBackendHealth()).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await api.checkBackendHealth()).toBeNull();
  });
});

describe("video endpoints", () => {
  it("getVideos GETs /api/videos and parses the list", async () => {
    const calls = mockFetch([{ body: { videos: [{ video_id: "v1" }], total: 1 } }]);
    const r = await api.getVideos();
    expect(r.total).toBe(1);
    expect(calls[0].url).toBe(`${BASE}/api/videos`);
    expect(calls[0].method).toBe("GET");
  });

  it("getVideos throws with statusText on failure", async () => {
    mockFetch([{ ok: false, status: 500, statusText: "Server Error" }]);
    await expect(api.getVideos()).rejects.toThrow("Failed to get videos list: Server Error");
  });

  it("checkVideoExists URL-encodes the filename query param", async () => {
    const calls = mockFetch([{ body: { exists: true, video_id: "v2" } }]);
    const r = await api.checkVideoExists("my clip (final).mp4");
    expect(r.exists).toBe(true);
    expect(calls[0].url).toBe(`${BASE}/api/videos/exists?filename=my%20clip%20(final).mp4`);
  });

  it("getVideoInfo GETs the per-video route", async () => {
    const calls = mockFetch([{ body: { video_id: "v3", width: 1920, height: 1080 } }]);
    const r = await api.getVideoInfo("v3");
    expect(r.width).toBe(1920);
    expect(calls[0].url).toBe(`${BASE}/api/videos/v3`);
  });

  it("getVideoStreamUrl returns the presigned payload", async () => {
    const calls = mockFetch([{ body: { url: "https://s3/stream", presigned: true } }]);
    const r = await api.getVideoStreamUrl("v4");
    expect(r).toEqual({ url: "https://s3/stream", presigned: true });
    expect(calls[0].url).toBe(`${BASE}/api/videos/v4/stream-url`);
  });

  it("detectScenes POSTs to the detect route and parses scenes", async () => {
    const calls = mockFetch([{ body: { video_id: "v5", total_scenes: 2, scenes: [] } }]);
    const r = await api.detectScenes("v5");
    expect(r.total_scenes).toBe(2);
    expect(calls[0].url).toBe(`${BASE}/api/videos/v5/scenes/detect`);
    expect(calls[0].method).toBe("POST");
  });
});

describe("auth header + 401 handling", () => {
  it("injects a Bearer token from localStorage when present", async () => {
    localStorage.setItem("auth_token", "TOK123");
    const calls = mockFetch([{ body: { videos: [], total: 0 } }]);
    await api.getVideos();
    expect(calls[0].headers.Authorization).toBe("Bearer TOK123");
  });

  it("omits the Authorization header when no token is stored", async () => {
    const calls = mockFetch([{ body: { videos: [], total: 0 } }]);
    await api.getVideos();
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("clears stored auth on a 401 before throwing", async () => {
    localStorage.setItem("auth_token", "TOK");
    localStorage.setItem("auth_user", "{}");
    mockFetch([{ ok: false, status: 401, statusText: "Unauthorized" }]);
    await expect(api.getVideos()).rejects.toThrow();
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
  });
});

describe("project CRUD", () => {
  it("createProject POSTs the request body", async () => {
    const calls = mockFetch([{ body: { id: "p1", name: "P", video_id: "v" } }]);
    const r = await api.createProject({ name: "P", video_id: "v", description: "d" });
    expect(r.id).toBe("p1");
    expect(calls[0].url).toBe(`${BASE}/api/projects`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ name: "P", video_id: "v", description: "d" });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  it("getProjects parses the list", async () => {
    mockFetch([{ body: { projects: [{ id: "p1" }], total: 1 } }]);
    expect((await api.getProjects()).total).toBe(1);
  });

  it("getProject GETs the per-project route", async () => {
    const calls = mockFetch([{ body: { id: "p7", name: "X", video_id: "v" } }]);
    expect((await api.getProject("p7")).id).toBe("p7");
    expect(calls[0].url).toBe(`${BASE}/api/projects/p7`);
  });

  it("updateProject PUTs partial updates", async () => {
    const calls = mockFetch([{ body: { id: "p1", name: "New", video_id: "v" } }]);
    await api.updateProject("p1", { name: "New" });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ name: "New" });
  });

  it("updateProject includes status code in its error message", async () => {
    mockFetch([{ ok: false, status: 422, statusText: "Unprocessable" }]);
    await expect(api.updateProject("p1", { name: "x" })).rejects.toThrow("Failed to update project: 422 Unprocessable");
  });

  it("deleteProject DELETEs and resolves void", async () => {
    const calls = mockFetch([{ body: {} }]);
    await expect(api.deleteProject("p1")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${BASE}/api/projects/p1`);
  });
});

describe("AI endpoints", () => {
  it("getAIStatus GETs /api/ai/status", async () => {
    const calls = mockFetch([{ body: { gpu_available: true, models: [] } }]);
    expect((await api.getAIStatus()).gpu_available).toBe(true);
    expect(calls[0].url).toBe(`${BASE}/api/ai/status`);
  });

  it("detectWithDINO POSTs the request and returns detections", async () => {
    const calls = mockFetch([{ body: { video_id: "v", frame_number: 3, detections: [{ label: "Sail" }], model: "DINO", confidence_threshold: 0.3 } }]);
    const r = await api.detectWithDINO({ video_id: "v", frame_number: 3 });
    expect(r.detections[0].label).toBe("Sail");
    expect(calls[0].url).toBe(`${BASE}/api/ai/dino/detect`);
    expect(calls[0].body).toEqual({ video_id: "v", frame_number: 3 });
  });

  it("segmentWithSAM2 returns the mask payload on success", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = mockFetch([{ body: { video_id: "v", frame_number: 0, mask: [], points: [{ x: 1, y: 2 }], bbox: { x: 0, y: 0, w: 1, h: 1 }, model: "SAM2" } }]);
    const r = await api.segmentWithSAM2({ video_id: "v", frame_number: 0, click_prompts: [{ x: 1, y: 2, type: "positive" }] });
    expect(r.points).toEqual([{ x: 1, y: 2 }]);
    expect(calls[0].url).toBe(`${BASE}/api/ai/sam2/segment`);
  });

  it("segmentWithSAM2 throws a body-level error even on a 200 response", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch([{ body: { success: false, error: "no object under click" } }]);
    await expect(
      api.segmentWithSAM2({ video_id: "v", frame_number: 0, click_prompts: [{ x: 0, y: 0, type: "positive" }] }),
    ).rejects.toThrow("no object under click");
  });

  it("segmentWithSAM2 surfaces statusText on a non-ok response", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch([{ ok: false, status: 500, statusText: "Internal", text: "stack trace" }]);
    await expect(
      api.segmentWithSAM2({ video_id: "v", frame_number: 0, click_prompts: [{ x: 0, y: 0, type: "positive" }] }),
    ).rejects.toThrow("SAM2 segmentation failed: Internal");
  });
});

describe("tracking endpoints", () => {
  it("createTrackingJob POSTs { segments } to the per-video route", async () => {
    const calls = mockFetch([{ body: { job_id: "parent-1", video_id: "v" } }]);
    const segs = [{ start_frame: 0, end_frame: 50, click_prompts: [] }];
    await api.createTrackingJob("v", segs);
    expect(calls[0].url).toBe(`${BASE}/api/videos/v/tracking/jobs`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ segments: segs });
  });

  it("executeTrackingJob POSTs to the execute route", async () => {
    const calls = mockFetch([{ body: { job_id: "j1", status: "started" } }]);
    expect((await api.executeTrackingJob("j1")).status).toBe("started");
    expect(calls[0].url).toBe(`${BASE}/api/tracking/jobs/j1/execute`);
  });

  it("getTrackingJobStatus adds a cache-buster and no-cache headers", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = mockFetch([{ body: { job_id: "j1", status: "running", percentage: 40 } }]);
    const r = await api.getTrackingJobStatus("j1");
    expect(r.percentage).toBe(40);
    expect(calls[0].url).toMatch(new RegExp(`^${BASE}/api/tracking/jobs/j1/status\\?t=\\d+$`));
    expect(calls[0].headers["Cache-Control"]).toContain("no-cache");
  });

  it("getTrackingJobResults returns results when available immediately", async () => {
    const calls = mockFetch([{ body: { job_id: "j1", video_id: "v", start_frame: 0, end_frame: 20, results: [{ frame_number: 0, bbox: [1, 2, 3, 4] }] } }]);
    const r = await api.getTrackingJobResults("j1");
    expect(r.results).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/tracking/jobs/j1/results`);
  });

  it("getTrackingJobResults throws immediately on a hard (non-404) error", async () => {
    mockFetch([{ ok: false, status: 500, statusText: "Boom", text: "trace" }]);
    await expect(api.getTrackingJobResults("j1")).rejects.toThrow("Failed to get tracking job results: 500 Boom");
  });
});

describe("YouTube download endpoints", () => {
  it("downloadFromYouTube POSTs the request", async () => {
    const calls = mockFetch([{ body: { job_id: "yt1", status: "queued", message: "ok" } }]);
    const r = await api.downloadFromYouTube({ url: "https://youtu.be/abc" });
    expect(r.job_id).toBe("yt1");
    expect(calls[0].url).toBe(`${BASE}/api/videos/download-youtube`);
    expect(calls[0].body).toEqual({ url: "https://youtu.be/abc" });
  });

  it("downloadFromYouTube prefers the JSON error field over statusText", async () => {
    mockFetch([{ ok: false, status: 400, statusText: "Bad Request", body: { error: "invalid url" } }]);
    await expect(api.downloadFromYouTube({ url: "nope" })).rejects.toThrow("invalid url");
  });

  it("getYouTubeDownloadStatus GETs the status route", async () => {
    const calls = mockFetch([{ body: { job_id: "yt1", status: "downloading", progress: 20 } }]);
    expect((await api.getYouTubeDownloadStatus("yt1")).progress).toBe(20);
    expect(calls[0].url).toBe(`${BASE}/api/videos/download-youtube/yt1/status`);
  });

  it("cancelYouTubeDownload DELETEs the job", async () => {
    const calls = mockFetch([{ body: {} }]);
    await expect(api.cancelYouTubeDownload("yt1")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${BASE}/api/videos/download-youtube/yt1`);
  });
});

describe("dataset export / persistence helpers", () => {
  it("createBackendProject POSTs name+video+description", async () => {
    const calls = mockFetch([{ body: { id: "p1" } }]);
    expect((await api.createBackendProject("N", "v", "desc")).id).toBe("p1");
    expect(calls[0].body).toEqual({ name: "N", video_id: "v", description: "desc" });
  });

  it("createBackendClass POSTs to the classes route and names the class in errors", async () => {
    const calls = mockFetch([{ body: { id: "c1" } }]);
    await api.createBackendClass("p1", "Sail", "#ef4444");
    expect(calls[0].url).toBe(`${BASE}/api/projects/p1/classes`);
    expect(calls[0].body).toEqual({ name: "Sail", color: "#ef4444" });

    mockFetch([{ ok: false, status: 409, statusText: "Conflict" }]);
    await expect(api.createBackendClass("p1", "Sail", "#000")).rejects.toThrow("Failed to create class 'Sail': 409 Conflict");
  });

  it("saveBackendAnnotations PUTs { annotations } and returns saved count", async () => {
    const anns = [{ instance_id: "i1", class_id: "c1", frame_number: 0, annotation_type: "bbox", geometry: { bbox: { x: 0, y: 0, w: 1, h: 1 } }, is_keyframe: true }];
    const calls = mockFetch([{ body: { saved: 1 } }]);
    expect((await api.saveBackendAnnotations("p1", anns)).saved).toBe(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ annotations: anns });
  });

  it("getExportSinks lists sinks", async () => {
    const calls = mockFetch([{ body: { sinks: ["zip", "clearml"] } }]);
    expect((await api.getExportSinks()).sinks).toEqual(["zip", "clearml"]);
    expect(calls[0].url).toBe(`${BASE}/api/export/sinks`);
  });

  it("getVideoDatasetVersions unwraps .versions and defaults to [] when absent", async () => {
    mockFetch([{ body: { versions: [{ version_id: "dsv1", status: "ready", models: [] }] } }]);
    expect(await api.getVideoDatasetVersions("v")).toHaveLength(1);
    mockFetch([{ body: {} }]);
    expect(await api.getVideoDatasetVersions("v")).toEqual([]);
  });

  it("startExport POSTs the sink and returns a job id", async () => {
    const calls = mockFetch([{ body: { job_id: "ex1" } }]);
    expect((await api.startExport("p1", "clearml")).job_id).toBe("ex1");
    expect(calls[0].url).toBe(`${BASE}/api/projects/p1/export`);
    expect(calls[0].body).toEqual({ sink: "clearml" });
  });

  it("startExport defaults the sink to 'zip'", async () => {
    const calls = mockFetch([{ body: { job_id: "ex2" } }]);
    await api.startExport("p1");
    expect(calls[0].body).toEqual({ sink: "zip" });
  });

  it("getExportStatus GETs the status route", async () => {
    const calls = mockFetch([{ body: { job_id: "ex1", status: "running", progress: 50 } }]);
    expect((await api.getExportStatus("p1", "ex1")).progress).toBe(50);
    expect(calls[0].url).toBe(`${BASE}/api/projects/p1/export/status/ex1`);
  });
});
