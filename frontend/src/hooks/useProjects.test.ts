import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjects, mergeBackendProjects, type UseProjectsOptions, type ProjectsApi } from "./useProjects";
import { Project } from "@/types/project";
import { Annotation } from "@/types/annotation";
import type { ProjectResponse } from "@/lib/api";

// ---------- fixtures ----------

const emptyAnnotationState = {
  classes: [],
  instances: [],
  annotations: [],
  keyframes: [],
  scenes: [],
  videoMetadata: {},
};

function makeAnnotation(id: string): Annotation {
  return {
    id,
    instanceId: `inst-${id}`,
    frameCreated: 0,
    points: [],
    isKeyframe: true,
  };
}

function makeLocalProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Local project",
    videoIds: ["v1"],
    createdAt: 1_000,
    lastModified: 1_000,
    classes: [],
    instances: [],
    annotations: [],
    keyframes: [],
    scenes: [],
    videoMetadata: {},
    ...overrides,
  };
}

function makeBackendProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: "p1",
    name: "Backend project",
    video_id: "v1",
    created_at: new Date(1_000).toISOString(),
    last_modified: new Date(1_000).toISOString(),
    ...overrides,
  };
}

function makeApi(overrides: Partial<ProjectsApi> = {}): ProjectsApi {
  return {
    getProjects: vi.fn().mockResolvedValue({ projects: [], total: 0 }),
    getProject: vi.fn().mockResolvedValue(makeBackendProject()),
    updateProject: vi.fn().mockResolvedValue(makeBackendProject()),
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseProjectsOptions> = {}): UseProjectsOptions {
  return {
    backendStatus: "offline",
    annotationState: emptyAnnotationState,
    toast: vi.fn(),
    findVideo: () => undefined,
    openProjectWorkspace: vi.fn().mockResolvedValue(undefined),
    clearWorkspace: vi.fn(),
    api: makeApi(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------- localStorage round-trip ----------

describe("useProjects localStorage persistence", () => {
  it("loads projects and activeProjectId from localStorage on mount", () => {
    // NOTE: no activeProjectId here — the mount auto-save (preserved from
    // Index.tsx) immediately writes the current (empty) workspace state into
    // the active project, so annotations are only inspectable on inactive ones.
    const stored = makeLocalProject({ annotations: [makeAnnotation("a1")] });
    localStorage.setItem("projects", JSON.stringify([stored]));

    const { result } = renderHook(() => useProjects(makeOptions()));

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].id).toBe("p1");
    expect(result.current.projects[0].annotations).toHaveLength(1);
    expect(result.current.activeProjectId).toBeNull();
  });

  it("loads activeProjectId from localStorage on mount", () => {
    localStorage.setItem("projects", JSON.stringify([makeLocalProject()]));
    localStorage.setItem("activeProjectId", "p1");

    const { result } = renderHook(() => useProjects(makeOptions()));

    expect(result.current.activeProjectId).toBe("p1");
  });

  it("persists created projects and active project id back to localStorage", () => {
    const { result } = renderHook(() => useProjects(makeOptions()));

    act(() => {
      result.current.handleProjectCreate("Round trip");
    });

    const stored = JSON.parse(localStorage.getItem("projects") ?? "[]") as Project[];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Round trip");
    expect(localStorage.getItem("activeProjectId")).toBe(stored[0].id);
  });

  it("removes activeProjectId from localStorage when cleared", () => {
    localStorage.setItem("projects", JSON.stringify([makeLocalProject()]));
    localStorage.setItem("activeProjectId", "p1");

    const { result } = renderHook(() => useProjects(makeOptions()));
    act(() => {
      result.current.handleProjectDelete("p1");
    });

    expect(localStorage.getItem("activeProjectId")).toBeNull();
    expect(JSON.parse(localStorage.getItem("projects") ?? "[]")).toHaveLength(0);
  });
});

// ---------- migration integration ----------

describe("useProjects stored-format migration", () => {
  it("migrates legacy single-videoId projects via migrateStoredProjects", () => {
    localStorage.setItem(
      "projects",
      JSON.stringify([{ ...makeLocalProject(), videoIds: undefined, videoId: "legacy-video" }])
    );

    const { result } = renderHook(() => useProjects(makeOptions()));

    expect(result.current.projects[0].videoIds).toEqual(["legacy-video"]);
  });

  it("survives malformed localStorage payloads", () => {
    localStorage.setItem("projects", "{not json");

    const { result } = renderHook(() => useProjects(makeOptions()));

    expect(result.current.projects).toEqual([]);
  });
});

// ---------- backend hydration ----------

describe("useProjects backend hydration", () => {
  it("hydrates the settings blob from the backend when localStorage is empty", async () => {
    const settings = {
      classes: [{ id: "c1", name: "Sail", color: "red", colorName: "Red" }],
      instances: [],
      annotations: [makeAnnotation("backend-ann")],
      keyframes: [],
      scenes: [],
      videoMetadata: { Location: "Maui" },
    };
    const api = makeApi({
      getProjects: vi.fn().mockResolvedValue({
        projects: [makeBackendProject({ last_modified: new Date(5_000).toISOString() })],
        total: 1,
      }),
      getProject: vi.fn().mockResolvedValue(makeBackendProject({ settings })),
    });

    const { result } = renderHook(() => useProjects(makeOptions({ backendStatus: "healthy", api })));

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(api.getProject).toHaveBeenCalledWith("p1");
    expect(result.current.projects[0].annotations.map((a) => a.id)).toEqual(["backend-ann"]);
    expect(result.current.projects[0].classes).toHaveLength(1);
    expect(result.current.projects[0].videoMetadata).toEqual({ Location: "Maui" });
    expect(result.current.projects[0].videoIds).toEqual(["v1"]);
  });

  it("uses the settings blob from the list response without an extra getProject call", async () => {
    const settings = { annotations: [makeAnnotation("list-ann")] };
    const api = makeApi({
      getProjects: vi.fn().mockResolvedValue({
        projects: [makeBackendProject({ settings })],
        total: 1,
      }),
    });

    const { result } = renderHook(() => useProjects(makeOptions({ backendStatus: "healthy", api })));

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(api.getProject).not.toHaveBeenCalled();
    expect(result.current.projects[0].annotations.map((a) => a.id)).toEqual(["list-ann"]);
  });

  it("keeps the local copy when it is newer than the backend copy", async () => {
    const local = makeLocalProject({
      lastModified: 9_000,
      annotations: [makeAnnotation("local-ann")],
    });
    localStorage.setItem("projects", JSON.stringify([local]));

    const api = makeApi({
      getProjects: vi.fn().mockResolvedValue({
        projects: [
          makeBackendProject({
            last_modified: new Date(2_000).toISOString(),
            settings: { annotations: [makeAnnotation("stale-backend-ann")] },
          }),
        ],
        total: 1,
      }),
    });

    const { result } = renderHook(() => useProjects(makeOptions({ backendStatus: "healthy", api })));

    await waitFor(() => expect(api.getProjects).toHaveBeenCalled());
    // Local wins: annotations and name untouched, no hydration fetch
    await waitFor(() =>
      expect(result.current.projects[0].annotations.map((a) => a.id)).toEqual(["local-ann"])
    );
    expect(result.current.projects[0].name).toBe("Local project");
    expect(api.getProject).not.toHaveBeenCalled();
  });

  it("never clobbers local annotations with empty backend data", async () => {
    const local = makeLocalProject({
      lastModified: 1_000,
      annotations: [makeAnnotation("precious")],
      videoMetadata: { Location: "Local spot" },
    });
    localStorage.setItem("projects", JSON.stringify([local]));

    // Backend copy is NEWER but its settings blob is empty
    const api = makeApi({
      getProjects: vi.fn().mockResolvedValue({
        projects: [
          makeBackendProject({
            name: "Renamed on backend",
            last_modified: new Date(8_000).toISOString(),
          }),
        ],
        total: 1,
      }),
      getProject: vi.fn().mockResolvedValue(makeBackendProject({ settings: {} })),
    });

    const { result } = renderHook(() => useProjects(makeOptions({ backendStatus: "healthy", api })));

    await waitFor(() => expect(result.current.projects[0].name).toBe("Renamed on backend"));
    // Annotation state preserved despite backend being newer-but-empty
    expect(result.current.projects[0].annotations.map((a) => a.id)).toEqual(["precious"]);
    expect(result.current.projects[0].videoMetadata).toEqual({ Location: "Local spot" });
    expect(result.current.projects[0].lastModified).toBe(8_000);
  });

  it("tolerates a getProject failure during hydration", async () => {
    const api = makeApi({
      getProjects: vi.fn().mockResolvedValue({
        projects: [makeBackendProject()],
        total: 1,
      }),
      getProject: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const { result } = renderHook(() => useProjects(makeOptions({ backendStatus: "healthy", api })));

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.projects[0].annotations).toEqual([]);
  });
});

// ---------- mergeBackendProjects unit ----------

describe("mergeBackendProjects", () => {
  it("unions videoIds so locally-added videos are never dropped", async () => {
    const local = makeLocalProject({ videoIds: ["v1", "v2"], lastModified: 1_000 });
    const merged = await mergeBackendProjects(
      [local],
      [makeBackendProject({ last_modified: new Date(5_000).toISOString() })],
      vi.fn().mockRejectedValue(new Error("no settings"))
    );

    expect(merged[0].videoIds).toEqual(["v1", "v2"]);
  });

  it("adds backend-only projects to the list", async () => {
    const merged = await mergeBackendProjects(
      [makeLocalProject()],
      [makeBackendProject({ id: "p2", name: "Other", video_id: "v9" })],
      vi.fn().mockRejectedValue(new Error("no settings"))
    );

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ id: "p2", name: "Other", videoIds: ["v9"], annotations: [] });
  });
});

// ---------- debounced auto-save ----------

describe("useProjects debounced backend auto-save", () => {
  it("fires updateProject with the settings blob after the 2s debounce", async () => {
    vi.useFakeTimers();
    localStorage.setItem("projects", JSON.stringify([makeLocalProject()]));
    localStorage.setItem("activeProjectId", "p1");

    const api = makeApi();
    const annotationState = {
      ...emptyAnnotationState,
      annotations: [makeAnnotation("autosaved")],
    };

    renderHook(() =>
      useProjects(makeOptions({ backendStatus: "healthy", api, annotationState }))
    );

    expect(api.updateProject).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(api.updateProject).toHaveBeenCalledTimes(1);
    const [projectId, updates] = vi.mocked(api.updateProject).mock.calls[0];
    expect(projectId).toBe("p1");
    expect(updates.name).toBe("Local project");
    expect(updates.settings?.annotations).toHaveLength(1);
    expect(updates.settings?.annotations[0].id).toBe("autosaved");
  });

  it("does not call the backend while offline", async () => {
    vi.useFakeTimers();
    localStorage.setItem("projects", JSON.stringify([makeLocalProject()]));
    localStorage.setItem("activeProjectId", "p1");

    const api = makeApi();
    renderHook(() => useProjects(makeOptions({ backendStatus: "offline", api })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it("debounces: unmounting before 2s cancels the pending save", async () => {
    vi.useFakeTimers();
    localStorage.setItem("projects", JSON.stringify([makeLocalProject()]));
    localStorage.setItem("activeProjectId", "p1");

    const api = makeApi();
    const { unmount } = renderHook(() =>
      useProjects(makeOptions({ backendStatus: "healthy", api }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(api.updateProject).not.toHaveBeenCalled();
  });
});

// ---------- handlers ----------

describe("useProjects handlers", () => {
  it("handleProjectSelect opens the workspace for a ready video", async () => {
    const local = makeLocalProject({ annotations: [makeAnnotation("a1")] });
    localStorage.setItem("projects", JSON.stringify([local]));

    const openProjectWorkspace = vi.fn().mockResolvedValue(undefined);
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useProjects(
        makeOptions({
          openProjectWorkspace,
          toast,
          findVideo: (id) =>
            id === "v1"
              ? {
                  id: "v1",
                  filename: "clip.mp4",
                  status: "ready" as const,
                  metadata: { duration: 10, fps: 30, width: 1280, height: 720, totalFrames: 300 },
                  isActive: false,
                  createdAt: 0,
                  lastAccessedAt: 0,
                }
              : undefined,
        })
      )
    );

    await act(async () => {
      await result.current.handleProjectSelect("p1");
    });

    expect(result.current.activeProjectId).toBe("p1");
    expect(result.current.currentVideoIdInProject).toBe("v1");
    expect(openProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
      "v1"
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Project loaded" })
    );
  });

  it("handleProjectSelect is a no-op when the video is not ready", async () => {
    localStorage.setItem("projects", JSON.stringify([makeLocalProject()]));

    const openProjectWorkspace = vi.fn();
    const { result } = renderHook(() =>
      useProjects(makeOptions({ openProjectWorkspace, findVideo: () => undefined }))
    );

    await act(async () => {
      await result.current.handleProjectSelect("p1");
    });

    expect(result.current.activeProjectId).toBeNull();
    expect(openProjectWorkspace).not.toHaveBeenCalled();
  });

  it("handleProjectDelete clears the workspace only for the active project", () => {
    localStorage.setItem(
      "projects",
      JSON.stringify([makeLocalProject(), makeLocalProject({ id: "p2", name: "Other" })])
    );
    localStorage.setItem("activeProjectId", "p1");

    const clearWorkspace = vi.fn();
    const { result } = renderHook(() => useProjects(makeOptions({ clearWorkspace })));

    act(() => {
      result.current.handleProjectDelete("p2");
    });
    expect(clearWorkspace).not.toHaveBeenCalled();
    expect(result.current.activeProjectId).toBe("p1");

    act(() => {
      result.current.handleProjectDelete("p1");
    });
    expect(clearWorkspace).toHaveBeenCalledTimes(1);
    expect(result.current.activeProjectId).toBeNull();
    expect(result.current.projects).toHaveLength(0);
  });

  it("handleProjectRename updates name and lastModified", () => {
    localStorage.setItem("projects", JSON.stringify([makeLocalProject({ lastModified: 1 })]));

    const { result } = renderHook(() => useProjects(makeOptions()));

    act(() => {
      result.current.handleProjectRename("p1", "New name");
    });

    expect(result.current.projects[0].name).toBe("New name");
    expect(result.current.projects[0].lastModified).toBeGreaterThan(1);
  });
});
