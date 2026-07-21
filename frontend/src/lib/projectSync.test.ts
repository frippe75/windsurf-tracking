import { describe, it, expect, vi } from "vitest";
import { saveProjectToBackend, type ProjectSyncApi } from "./projectSync";
import type { Project } from "@/types/project";
import type { ProjectAnnotationState } from "@/hooks/useProjects";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "local-123",
    name: "My Project",
    videoIds: ["vid-1"],
    createdAt: 1,
    lastModified: 1,
    classes: [],
    instances: [],
    annotations: [],
    keyframes: [],
    scenes: [],
    videoMetadata: {},
    ...overrides,
  };
}

const state: ProjectAnnotationState = {
  classes: [{ id: "c1", name: "sail", color: "#e11", colorName: "red" }],
  instances: [],
  annotations: [],
  keyframes: [],
  scenes: [],
  videoMetadata: {},
};

function makeApi(overrides: Partial<ProjectSyncApi> = {}): ProjectSyncApi {
  return {
    updateProject: vi.fn().mockResolvedValue({} as any),
    createProject: vi.fn().mockResolvedValue({ id: "backend-uuid" } as any),
    ...overrides,
  };
}

describe("saveProjectToBackend", () => {
  it("updates an already-backed project by its backendProjectId (no create)", async () => {
    const api = makeApi();
    const res = await saveProjectToBackend(makeProject({ backendProjectId: "backend-1" }), state, api);
    expect(res).toEqual({});
    expect(api.updateProject).toHaveBeenCalledWith("backend-1", expect.objectContaining({ name: "My Project" }));
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it("persists the project description to the backend on update", async () => {
    const api = makeApi();
    await saveProjectToBackend(makeProject({ backendProjectId: "backend-1", description: "windsurf sail dataset" }), state, api);
    expect(api.updateProject).toHaveBeenCalledWith("backend-1", expect.objectContaining({ description: "windsurf sail dataset" }));
  });

  it("updates by local id when that id already exists on the backend (adopted-id projects)", async () => {
    const api = makeApi();
    const res = await saveProjectToBackend(makeProject({ id: "adopted-uuid" }), state, api);
    expect(res).toEqual({});
    expect(api.updateProject).toHaveBeenCalledWith("adopted-uuid", expect.anything());
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it("creates the backend project on 404, then updates, returning the new id", async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to update project: 404 Not Found"))
      .mockResolvedValueOnce({} as any);
    const api = makeApi({ updateProject: update });

    const res = await saveProjectToBackend(makeProject(), state, api);

    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Project", video_id: "vid-1" })
    );
    expect(update).toHaveBeenLastCalledWith("backend-uuid", expect.anything());
    expect(res).toEqual({ backendProjectId: "backend-uuid" });
  });

  it("does not create (and rethrows) when a 404 project has no video yet", async () => {
    const api = makeApi({
      updateProject: vi.fn().mockRejectedValue(new Error("Failed to update project: 404 Not Found")),
    });
    await expect(saveProjectToBackend(makeProject({ videoIds: [] }), state, api)).rejects.toThrow(/404/);
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it("rethrows non-404 errors without creating", async () => {
    const api = makeApi({
      updateProject: vi.fn().mockRejectedValue(new Error("Failed to update project: 500 Server Error")),
    });
    await expect(saveProjectToBackend(makeProject(), state, api)).rejects.toThrow(/500/);
    expect(api.createProject).not.toHaveBeenCalled();
  });
});
