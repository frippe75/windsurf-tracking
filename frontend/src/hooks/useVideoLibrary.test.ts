import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useVideoLibrary, mergeBackendVideos, reconcileStaleProgress, pruneDeletedBackendVideos, type UseVideoLibraryOptions, type VideoLibraryApi } from "./useVideoLibrary";
import { ManagedVideo } from "@/types/video";
import type { VideoInfoResponse } from "@/lib/api";
import { videoCache } from "@/lib/videoCache";

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
  // Stub the IndexedDB blob cache so the backend-sync prune never touches real
  // storage or logs; individual tests re-spy .delete when they assert on it.
  vi.spyOn(videoCache, "init").mockResolvedValue();
  vi.spyOn(videoCache, "delete").mockResolvedValue();
});

afterEach(() => {
  // Unmount rendered hooks first (removes focus listeners, sets disposed=true so
  // any pending backend sync bails) before restoring mocks — keeps the new
  // focus re-sync from leaking across tests.
  cleanup();
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

describe("reconcileStaleProgress", () => {
  it("drops stale downloading/syncing entries, keeps ready/error", () => {
    const local = [
      makeLocalVideo({ id: "a", status: "ready" }),
      makeLocalVideo({ id: "b", status: "downloading" }),
      makeLocalVideo({ id: "c", status: "syncing" }),
      makeLocalVideo({ id: "d", status: "error" }),
    ];
    expect(reconcileStaleProgress(local).map((v) => v.id)).toEqual(["a", "d"]);
  });
});

describe("useVideoLibrary heals stuck entries on mount", () => {
  it("clears a frozen 'syncing' entry and shows the backend's ready copy", async () => {
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([
        // stale temp entry from an interrupted download (job-id keyed)
        makeLocalVideo({ id: "dl-123", filename: "Why.mp4", status: "syncing", frontendProgress: 41, metadata: undefined }),
      ])
    );
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({
        videos: [makeBackendVideo({ video_id: "real-id", filename: "Why.mp4" })],
        total: 1,
      }),
    });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(result.current.managedVideos.some((v) => v.id === "real-id")).toBe(true));
    // stale syncing entry gone; only the ready backend copy remains
    expect(result.current.managedVideos.map((v) => v.id)).toEqual(["real-id"]);
    expect(result.current.managedVideos[0].status).toBe("ready");
  });

  it("clears a stuck entry even when the backend is offline", async () => {
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([
        makeLocalVideo({ id: "ready-1", status: "ready" }),
        makeLocalVideo({ id: "dl-9", status: "downloading", backendProgress: 25 }),
      ])
    );
    const api = makeApi({ getVideos: vi.fn().mockRejectedValue(new Error("offline")) });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(result.current.managedVideos.map((v) => v.id)).toEqual(["ready-1"]));
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
    // Backend lists all three, so the mount sync keeps them (no prune) and we
    // exercise the delete itself, not the sync.
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({
        videos: [
          makeBackendVideo({ video_id: "v1", filename: "a.mp4" }),
          makeBackendVideo({ video_id: "v2", filename: "b.mp4" }),
          makeBackendVideo({ video_id: "v3", filename: "c.mp4" }),
        ],
        total: 3,
      }),
    });
    const { result } = renderHook(() => useVideoLibrary(makeOptions({ toast, api })));
    await waitFor(() =>
      expect(result.current.managedVideos.map((v) => v.id).sort()).toEqual(["v1", "v2", "v3"])
    );

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
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({ videos: [makeBackendVideo({ video_id: "v1" })], total: 1 }),
    });
    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));
    await waitFor(() => expect(result.current.managedVideos).toHaveLength(1));

    await act(async () => {
      await result.current.deleteVideosFromCache(["nope"]);
    });

    expect(result.current.managedVideos).toHaveLength(1);
  });
});

describe("pruneDeletedBackendVideos", () => {
  it("removes ready entries absent from the backend, keeps present ones", () => {
    const local = [
      makeLocalVideo({ id: "gone", status: "ready" }),
      makeLocalVideo({ id: "here", status: "ready" }),
    ];
    const backend = [makeBackendVideo({ video_id: "here" })];

    const { kept, removed } = pruneDeletedBackendVideos(local, backend);

    expect(removed.map((v) => v.id)).toEqual(["gone"]);
    expect(kept.map((v) => v.id)).toEqual(["here"]);
  });

  it("never prunes in-flight or error entries even when absent from the backend", () => {
    const local = [
      makeLocalVideo({ id: "dl", status: "downloading" }),
      makeLocalVideo({ id: "sy", status: "syncing" }),
      makeLocalVideo({ id: "qu", status: "queued" }),
      makeLocalVideo({ id: "er", status: "error" }),
    ];

    const { kept, removed } = pruneDeletedBackendVideos(local, []);

    expect(removed).toHaveLength(0);
    expect(kept.map((v) => v.id)).toEqual(["dl", "sy", "qu", "er"]);
  });
});

describe("useVideoLibrary follows the DB (prune deleted-from-backend videos)", () => {
  it("drops a ready video gone from the backend and purges its cached blob", async () => {
    const deleteSpy = vi.spyOn(videoCache, "delete").mockResolvedValue();
    vi.spyOn(videoCache, "init").mockResolvedValue();
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([
        makeLocalVideo({ id: "stays", filename: "stays.mp4", status: "ready" }),
        makeLocalVideo({ id: "deleted", filename: "deleted.mp4", status: "ready" }),
      ])
    );
    const toast = vi.fn();
    // backend only knows about "stays" now — "deleted" was removed elsewhere
    const api = makeApi({
      getVideos: vi.fn().mockResolvedValue({
        videos: [makeBackendVideo({ video_id: "stays", filename: "stays.mp4" })],
        total: 1,
      }),
    });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api, toast })));

    await waitFor(() => expect(result.current.managedVideos.map((v) => v.id)).toEqual(["stays"]));
    expect(deleteSpy).toHaveBeenCalledWith("deleted.mp4");
    expect(deleteSpy).not.toHaveBeenCalledWith("stays.mp4");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Removed 1 deleted video") })
    );
  });

  it("does not prune when the backend is offline (keeps the local library)", async () => {
    const deleteSpy = vi.spyOn(videoCache, "delete").mockResolvedValue();
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([makeLocalVideo({ id: "v1", filename: "a.mp4", status: "ready" })])
    );
    const api = makeApi({ getVideos: vi.fn().mockRejectedValue(new Error("offline")) });

    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api })));

    await waitFor(() => expect(api.getVideos).toHaveBeenCalled());
    expect(result.current.managedVideos.map((v) => v.id)).toEqual(["v1"]);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("re-syncs on tab focus and prunes a video deleted from another browser", async () => {
    vi.spyOn(videoCache, "delete").mockResolvedValue();
    vi.spyOn(videoCache, "init").mockResolvedValue();
    localStorage.setItem(
      "managedVideos",
      JSON.stringify([makeLocalVideo({ id: "v1", filename: "a.mp4", status: "ready" })])
    );
    const getVideos = vi
      .fn()
      // mount: video still present
      .mockResolvedValueOnce({ videos: [makeBackendVideo({ video_id: "v1", filename: "a.mp4" })], total: 1 })
      // after focus: video was deleted elsewhere
      .mockResolvedValueOnce({ videos: [], total: 0 });
    const { result } = renderHook(() => useVideoLibrary(makeOptions({ api: makeApi({ getVideos }) })));

    await waitFor(() => expect(getVideos).toHaveBeenCalledTimes(1));
    expect(result.current.managedVideos.map((v) => v.id)).toEqual(["v1"]);

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(result.current.managedVideos).toHaveLength(0));
    expect(getVideos).toHaveBeenCalledTimes(2);
  });
});
