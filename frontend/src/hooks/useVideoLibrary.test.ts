import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVideoLibrary, mergeBackendVideos, type UseVideoLibraryOptions, type VideoLibraryApi } from "./useVideoLibrary";
import { ManagedVideo } from "@/types/video";
import type { VideoInfoResponse } from "@/lib/api";

function makeLocalVideo(overrides: Partial<ManagedVideo> = {}): ManagedVideo {
  return {
    id: "v1",
    filename: "clip.mp4",
    status: "ready",
    metadata: { duration: 10, fps: 30, width: 1280, height: 720, totalFrames: 300 },
    isActive: false,
    createdAt: 100,
    lastAccessedAt: 100,
    ...overrides,
  };
}

function makeBackendVideo(overrides: Partial<VideoInfoResponse> = {}): VideoInfoResponse {
  return {
    video_id: "v1",
    filename: "clip.mp4",
    duration: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    total_frames: 300,
    file_size: 1_000_000,
    ...overrides,
  };
}

function makeApi(overrides: Partial<VideoLibraryApi> = {}): VideoLibraryApi {
  return {
    getVideos: vi.fn().mockResolvedValue({ videos: [], total: 0 }),
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseVideoLibraryOptions> = {}): UseVideoLibraryOptions {
  return {
    toast: vi.fn(),
    countProjectsUsingVideo: () => 0,
    api: makeApi(),
    now: () => 42,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useVideoLibrary persistence", () => {
  it("loads the library from localStorage on mount", () => {
    localStorage.setItem("managedVideos", JSON.stringify([makeLocalVideo()]));

    const { result } = renderHook(() => useVideoLibrary(makeOptions()));

    expect(result.current.managedVideos).toHaveLength(1);
    expect(result.current.managedVideos[0].id).toBe("v1");
  });

  it("persists added videos back to localStorage", async () => {
    const { result } = renderHook(() => useVideoLibrary(makeOptions()));

    act(() => {
      result.current.addVideo(makeLocalVideo({ id: "v2", filename: "new.mp4" }));
    });

    const stored = JSON.parse(localStorage.getItem("managedVideos") ?? "[]") as ManagedVideo[];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("v2");
  });

  it("survives malformed localStorage payloads", () => {
    localStorage.setItem("managedVideos", "{not json");

    const { result } = renderHook(() => useVideoLibrary(makeOptions()));

    expect(result.current.managedVideos).toEqual([]);
  });
});

describe("useVideoLibrary backend merge on mount", () => {
  it("adds backend-only videos as ready entries with API metadata", async () => {
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({
        videos: [makeBackendVideo({ video_id: "remote-1", filename: "remote.mp4" })],
        total: 1,
      }),
    });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(result.current.managedVideos).toHaveLength(1));
    const video = result.current.managedVideos[0];
    expect(video).toMatchObject({
      id: "remote-1",
      filename: "remote.mp4",
      status: "ready",
      isActive: false,
      createdAt: 42,
      lastAccessedAt: 42,
    });
    expect(video.metadata).toEqual({
      duration: 10,
      fps: 30,
      width: 1920,
      height: 1080,
      totalFrames: 300,
      fileSize: 1_000_000,
    });
    // Merged library is persisted
    const stored = JSON.parse(localStorage.getItem("managedVideos") ?? "[]") as ManagedVideo[];
    expect(stored).toHaveLength(1);
  });

  it("dedups by video_id and keeps local extra fields", async () => {
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([
        makeLocalVideo({
          youtubeUrl: "https://youtu.be/abc",
          youtubeThumbnail: "https://img.youtube.com/vi/abc/hqdefault.jpg",
        }),
      ])
    );
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({
        videos: [makeBackendVideo()],
        total: 1,
      }),
    });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(api.getVideos).toHaveBeenCalled());
    expect(result.current.managedVideos).toHaveLength(1);
    const video = result.current.managedVideos[0];
    expect(video.youtubeUrl).toBe("https://youtu.be/abc");
    // Local metadata wins over the backend copy
    expect(video.metadata?.width).toBe(1280);
    expect(video.createdAt).toBe(100);
  });

  it("fills in missing metadata on local entries from the backend", async () => {
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([makeLocalVideo({ metadata: undefined })])
    );
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({ videos: [makeBackendVideo()], total: 1 }),
    });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(result.current.managedVideos[0].metadata).toBeDefined());
    expect(result.current.managedVideos[0].metadata?.width).toBe(1920);
  });

  it("tolerates backend failure (offline) and keeps the local library", async () => {
    localStorage.setItem("managedVideos", JSON.stringify([makeLocalVideo()]));
    const api = makeApi({
      getVideos: vi.fn().mockRejectedValue(new Error("network down")),
    });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(api.getVideos).toHaveBeenCalled());
    expect(result.current.managedVideos).toHaveLength(1);
    expect(result.current.managedVideos[0].id).toBe("v1");
  });
});

describe("mergeBackendVideos", () => {
  it("unions local-only, shared, and backend-only videos", () => {
    const local = [
      makeLocalVideo({ id: "local-only", status: "syncing" }),
      makeLocalVideo({ id: "shared" }),
    ];
    const backend = [
      makeBackendVideo({ video_id: "shared" }),
      makeBackendVideo({ video_id: "backend-only" }),
    ];

    const merged = mergeBackendVideos(local, backend, () => 7);

    expect(merged.map((v) => v.id)).toEqual(["local-only", "shared", "backend-only"]);
    expect(merged[0].status).toBe("syncing");
    expect(merged[2].createdAt).toBe(7);
  });
});

describe("useVideoLibrary delete", () => {
  it("blocks deletion when the video is used by projects", () => {
    localStorage.setItem("managedVideos", JSON.stringify([makeLocalVideo()]));
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useVideoLibrary(makeOptions({ toast, countProjectsUsingVideo: () => 2 }))
    );

    act(() => {
      result.current.handleVideoDelete("v1");
    });

    expect(result.current.managedVideos).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Cannot delete video", variant: "destructive" })
    );
  });

  it("removes unused videos", () => {
    localStorage.setItem("managedVideos", JSON.stringify([makeLocalVideo()]));
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useVideoLibrary(makeOptions({ toast, countProjectsUsingVideo: () => 0 }))
    );

    act(() => {
      result.current.handleVideoDelete("v1");
    });

    expect(result.current.managedVideos).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Video deleted" }));
  });
});

describe("useVideoLibrary deleteVideosFromCache", () => {
  it("bulk-removes selected videos including stuck downloads", async () => {
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([
        makeLocalVideo({ id: "v1", filename: "a.mp4", status: "ready" }),
        makeLocalVideo({ id: "v2", filename: "b.mp4", status: "downloading" }),
        makeLocalVideo({ id: "v3", filename: "c.mp4", status: "ready" }),
      ])
    );
    const toast = vi.fn();
    const { result } = renderHook(() => useVideoLibrary(makeOptions({ toast })));

    await act(async () => {
      await result.current.deleteVideosFromCache(["v1", "v2"]);
    });

    const remaining = result.current.managedVideos.map((v) => v.id);
    expect(remaining).toEqual(["v3"]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Removed 2 videos") })
    );
  });

  it("is a no-op for ids not in the library", async () => {
    localStorage.setItem("managedVideos", JSON.stringify([makeLocalVideo({ id: "v1" })]));
    const { result } = renderHook(() => useVideoLibrary(makeOptions()));

    await act(async () => {
      await result.current.deleteVideosFromCache(["nope"]);
    });

    expect(result.current.managedVideos).toHaveLength(1);
  });
});
