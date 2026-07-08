import { describe, it, expect, vi } from "vitest";
import { resolveVideoSource, VideoSourceDeps } from "./videoSource";

const META = { duration: 10, fps: 30, width: 1920, height: 1080, totalFrames: 300 };

function makeDeps(overrides: Partial<VideoSourceDeps> = {}): VideoSourceDeps {
  return {
    getCached: vi.fn().mockResolvedValue(null),
    cacheVideo: vi.fn().mockResolvedValue(undefined),
    downloadVideo: vi.fn().mockResolvedValue(new Blob(["video"])),
    getStreamUrl: vi.fn().mockResolvedValue({ url: "https://s3/presigned", presigned: true }),
    createObjectURL: vi.fn().mockReturnValue("blob:local"),
    trackBlobUrl: vi.fn(),
    fallbackUrl: (id) => `/api/videos/${id}/download`,
    now: () => 1234,
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("resolveVideoSource", () => {
  it("cache hit: returns tracked blob URL, no download, no stream-url call", async () => {
    const deps = makeDeps({ getCached: vi.fn().mockResolvedValue({ blob: new Blob(["x"]) }) });
    const url = await resolveVideoSource("v1", "a.mp4", META, deps);
    expect(url).toBe("blob:local");
    expect(deps.trackBlobUrl).toHaveBeenCalledWith("blob:local");
    expect(deps.getStreamUrl).not.toHaveBeenCalled();
    expect(deps.downloadVideo).not.toHaveBeenCalled();
  });

  it("cache miss: plays presigned URL and background-fills the cache", async () => {
    const deps = makeDeps();
    const url = await resolveVideoSource("v1", "a.mp4", META, deps);
    expect(url).toBe("https://s3/presigned");
    await flush();
    expect(deps.downloadVideo).toHaveBeenCalledWith("v1");
    expect(deps.cacheVideo).toHaveBeenCalledWith(
      "a.mp4",
      expect.objectContaining({
        videoId: "v1",
        filename: "a.mp4",
        metadata: expect.objectContaining({ ...META, cachedAt: 1234 }),
      })
    );
  });

  it("cache miss without metadata: streams but does NOT background-cache", async () => {
    const deps = makeDeps();
    const url = await resolveVideoSource("v1", "a.mp4", undefined, deps);
    expect(url).toBe("https://s3/presigned");
    await flush();
    expect(deps.downloadVideo).not.toHaveBeenCalled();
  });

  it("stream-url failure falls back to /download proxy", async () => {
    const deps = makeDeps({ getStreamUrl: vi.fn().mockRejectedValue(new Error("boom")) });
    const url = await resolveVideoSource("v1", "a.mp4", META, deps);
    expect(url).toBe("/api/videos/v1/download");
  });

  it("cache lookup error degrades to streaming (does not throw)", async () => {
    const deps = makeDeps({ getCached: vi.fn().mockRejectedValue(new Error("idb broken")) });
    const url = await resolveVideoSource("v1", "a.mp4", META, deps);
    expect(url).toBe("https://s3/presigned");
  });

  it("background cache failure is swallowed and does not affect playback", async () => {
    const deps = makeDeps({ downloadVideo: vi.fn().mockRejectedValue(new Error("net")) });
    const url = await resolveVideoSource("v1", "a.mp4", META, deps);
    expect(url).toBe("https://s3/presigned");
    await flush();
    expect(deps.cacheVideo).not.toHaveBeenCalled();
  });
});
