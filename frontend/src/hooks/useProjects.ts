/**
 * Project state domain, extracted from pages/Index.tsx.
 *
 * Owns:
 * - `projects`, `activeProjectId`, `currentVideoIdInProject`
 * - localStorage persistence ('projects', 'activeProjectId') with format
 *   migration (lib/projectMigration)
 * - backend sync on backend-healthy (getProjects + settings-blob hydration)
 * - debounced backend auto-save of the active project's annotation state
 * - project create/select/delete/rename handlers
 *
 * Cross-domain effects (loading a video into the player, resetting the
 * annotation workspace) are injected as callbacks so this hook stays free of
 * video-player concerns. API functions are injected for testability and
 * default to the real client in lib/api.
 *
 * Backend hydration (fix over the original Index.tsx behavior): the backend
 * project list used to be merged with hardcoded empty annotation arrays,
 * making backend project state write-only and — worse — clobbering local
 * annotations whenever the backend copy was newer. Now, when the local copy
 * is missing or older (last_modified vs local lastModified), the settings
 * blob (classes/instances/annotations/keyframes/scenes/videoMetadata) is
 * read back via getProject. localStorage stays the fast path, and empty
 * backend data NEVER overwrites local annotations.
 */

import { useEffect, useState } from "react";
import { Class, Instance, Annotation, Keyframe, Scene, Track, MetaField } from "@/types/annotation";
import { Project, createEmptyProject } from "@/types/project";
import { ManagedVideo } from "@/types/video";
import { migrateStoredProjects } from "@/lib/projectMigration";
import {
  getProjects as apiGetProjects,
  getProject as apiGetProject,
  updateProject as apiUpdateProject,
  createProject as apiCreateProject,
  type ProjectResponse,
} from "@/lib/api";
import { saveProjectToBackend } from "@/lib/projectSync";

export type BackendStatus = "checking" | "healthy" | "offline";

export interface ProjectAnnotationState {
  classes: Class[];
  instances: Instance[];
  annotations: Annotation[];
  keyframes: Keyframe[];
  scenes: Scene[];
  tracks: Track[];
  metadataSchema: MetaField[];
  videoMetadata: Record<string, string>;
}

export interface ProjectsApi {
  getProjects: typeof apiGetProjects;
  getProject: typeof apiGetProject;
  updateProject: typeof apiUpdateProject;
  createProject: typeof apiCreateProject;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export interface UseProjectsOptions {
  backendStatus: BackendStatus;
  /** Current annotation workspace state; auto-saved into the active project. */
  annotationState: ProjectAnnotationState;
  toast: (options: ToastOptions) => void;
  /** Look up a video in the library (readiness gate for project select). */
  findVideo: (videoId: string) => ManagedVideo | undefined;
  /** Load a project's workspace (video player + annotation state) — owned by the page. */
  openProjectWorkspace: (project: Project, videoId: string) => Promise<void>;
  /** Reset the workspace after the active project is deleted — owned by the page. */
  clearWorkspace: () => void;
  /** Injectable API client (tests); defaults to lib/api. */
  api?: ProjectsApi;
}

const defaultApi: ProjectsApi = {
  getProjects: apiGetProjects,
  getProject: apiGetProject,
  updateProject: apiUpdateProject,
  createProject: apiCreateProject,
};

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const asRecord = (value: unknown): Record<string, string> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};

/** Extract the annotation-state blob written by the auto-saver from a backend settings object. */
function settingsToAnnotationState(settings: Record<string, unknown>): ProjectAnnotationState {
  return {
    classes: asArray<Class>(settings.classes),
    instances: asArray<Instance>(settings.instances),
    annotations: asArray<Annotation>(settings.annotations),
    keyframes: asArray<Keyframe>(settings.keyframes),
    scenes: asArray<Scene>(settings.scenes),
    tracks: asArray<Track>(settings.tracks),
    metadataSchema: asArray<MetaField>(settings.metadataSchema),
    videoMetadata: asRecord(settings.videoMetadata),
  };
}

/** True if a backend settings blob carries any annotation content worth hydrating. */
function settingsHasContent(settings: Record<string, unknown> | undefined | null): boolean {
  if (!settings) return false;
  const state = settingsToAnnotationState(settings);
  return (
    state.classes.length > 0 ||
    state.instances.length > 0 ||
    state.annotations.length > 0 ||
    state.keyframes.length > 0 ||
    state.scenes.length > 0 ||
    state.tracks.length > 0 ||
    state.metadataSchema.length > 0 ||
    Object.keys(state.videoMetadata).length > 0
  );
}

/**
 * Merge the backend project list into the local (localStorage-backed) list.
 *
 * Rules:
 * - Local project newer or same age (lastModified) → local copy wins untouched.
 * - Backend copy newer or local missing → hydrate the settings blob (from the
 *   list response, or via fetchProject when the list omits it) and take the
 *   backend annotation state. If the backend blob is EMPTY, keep the local
 *   annotation arrays (never clobber local data with empty backend data) and
 *   only refresh name/videoIds/lastModified.
 */
export async function mergeBackendProjects(
  localProjects: Project[],
  backendProjects: ProjectResponse[],
  fetchProject: (projectId: string) => Promise<ProjectResponse>
): Promise<Project[]> {
  const merged = [...localProjects];

  for (const bp of backendProjects) {
    // Backend stores a single video; convert to the frontend's array form
    const backendVideoIds = bp.video_id ? [bp.video_id] : [];
    const createdAt = new Date(bp.created_at).getTime();
    const lastModified = new Date(bp.last_modified).getTime();

    const existingIdx = merged.findIndex((p) => (p.backendProjectId ?? p.id) === bp.id);
    const local = existingIdx >= 0 ? merged[existingIdx] : undefined;

    // Keep the one with the latest modification (ties keep local, as before)
    if (local && lastModified <= local.lastModified) continue;

    // Local missing or older: read back the settings blob
    let settings: Record<string, unknown> | undefined = bp.settings;
    if (!settingsHasContent(settings)) {
      try {
        settings = (await fetchProject(bp.id)).settings;
      } catch (error) {
        console.error(`Failed to hydrate project ${bp.id} from backend:`, error);
        settings = undefined;
      }
    }
    const hydrated = settingsHasContent(settings)
      ? settingsToAnnotationState(settings as Record<string, unknown>)
      : undefined;

    if (!local) {
      merged.push({
        id: bp.id,
        backendProjectId: bp.id,
        name: bp.name,
        videoIds: backendVideoIds,
        createdAt,
        lastModified,
        ...(hydrated ?? {
          classes: [],
          instances: [],
          annotations: [],
          keyframes: [],
          scenes: [],
          tracks: [],
          metadataSchema: [],
          videoMetadata: {},
        }),
      });
    } else {
      merged[existingIdx] = {
        ...local,
        name: bp.name,
        // Union so locally-added videos are never dropped by the single-video backend model
        videoIds: Array.from(new Set([...local.videoIds, ...backendVideoIds])),
        lastModified,
        // Empty backend blob → local annotation state stays untouched
        ...(hydrated ?? {}),
      };
    }
  }

  return merged;
}

export function useProjects(options: UseProjectsOptions) {
  const { backendStatus, toast, findVideo, openProjectWorkspace, clearWorkspace } = options;
  const { classes, instances, annotations, keyframes, scenes, tracks, metadataSchema, videoMetadata } =
    options.annotationState;
  const api = options.api ?? defaultApi;

  // Projects state with localStorage fallback (format migration in lib/projectMigration)
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      return migrateStoredProjects(localStorage.getItem("projects"));
    } catch {
      return [];
    }
  });

  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("activeProjectId");
    } catch {
      return null;
    }
  });

  // Track which video in the project is currently being viewed
  const [currentVideoIdInProject, setCurrentVideoIdInProject] = useState<string | null>(null);

  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  // Sync projects with backend (when online), hydrating settings blobs
  useEffect(() => {
    const syncWithBackend = async () => {
      if (backendStatus !== "healthy") return;

      try {
        setIsLoadingProjects(true);
        const response = await api.getProjects();
        const mergedProjects = await mergeBackendProjects(
          projects,
          response.projects,
          api.getProject
        );
        setProjects(mergedProjects);
      } catch (error) {
        console.error("Failed to sync with backend:", error);
        // Continue with localStorage projects
      } finally {
        setIsLoadingProjects(false);
      }
    };

    syncWithBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendStatus]);

  // Persist projects to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("projects", JSON.stringify(projects));
    } catch (error) {
      console.error("Failed to save projects:", error);
    }
  }, [projects]);

  // Persist active project ID to localStorage
  useEffect(() => {
    try {
      if (activeProjectId) {
        localStorage.setItem("activeProjectId", activeProjectId);
      } else {
        localStorage.removeItem("activeProjectId");
      }
    } catch (error) {
      console.error("Failed to save active project ID:", error);
    }
  }, [activeProjectId]);

  // Auto-save current project annotations (local immediately, backend debounced)
  useEffect(() => {
    if (!activeProjectId) return;

    const project = projects.find((p) => p.id === activeProjectId);
    if (!project) return;

    // Update local state
    const updatedProject: Project = {
      ...project,
      classes,
      instances,
      annotations,
      keyframes,
      scenes,
      tracks,
      metadataSchema,
      videoMetadata,
      lastModified: Date.now(),
    };

    setProjects((prev) => prev.map((p) => (p.id === activeProjectId ? updatedProject : p)));

    // Try to save to backend if online (debounced). saveProjectToBackend backs the
    // project on first save (creating the backend project when needed) so
    // explicitly-created projects — not just video-select ones — become durable.
    if (backendStatus === "healthy") {
      const timeoutId = setTimeout(async () => {
        try {
          const { backendProjectId } = await saveProjectToBackend(
            updatedProject,
            { classes, instances, annotations, keyframes, scenes, tracks, metadataSchema, videoMetadata },
            api,
          );
          if (backendProjectId) {
            setProjects((prev) =>
              prev.map((p) => (p.id === activeProjectId ? { ...p, backendProjectId } : p))
            );
          }
          console.log("💾 Auto-saved project to backend");
        } catch (error) {
          console.error("Failed to auto-save to backend (offline mode active):", error);
        }
      }, 2000);

      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, classes, instances, annotations, keyframes, scenes, tracks, metadataSchema, videoMetadata, backendStatus]);

  const handleProjectCreate = (name: string) => {
    const newProject = createEmptyProject(name);
    setProjects((prev) => [...prev, newProject]);
    setActiveProjectId(newProject.id);
    toast({
      title: "Project created",
      description: name,
    });
  };

  const handleProjectSelect = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || project.videoIds.length === 0) return;

    // Use first video in project
    const firstVideoId = project.videoIds[0];
    const video = findVideo(firstVideoId);
    if (!video || video.status !== "ready" || !video.metadata) return;

    console.log("🔄 Switching to project:", project.name);
    setActiveProjectId(projectId);
    setCurrentVideoIdInProject(firstVideoId);

    // Load project state into the workspace (annotation state + video player)
    await openProjectWorkspace(project, firstVideoId);

    toast({
      title: "Project loaded",
      description: `Switched to "${project.name}"`,
    });
  };

  const handleProjectDelete = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));

    // If deleting active project, clear it
    if (projectId === activeProjectId) {
      setActiveProjectId(null);
      clearWorkspace();

      toast({
        title: "Project deleted",
        description: "Project has been removed",
      });
    } else {
      toast({
        title: "Project deleted",
      });
    }
  };

  const handleProjectRename = (projectId: string, newName: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, name: newName, lastModified: Date.now() } : p
      )
    );

    toast({
      title: "Project renamed",
      description: `Project renamed to "${newName}"`,
    });
  };

  return {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    currentVideoIdInProject,
    setCurrentVideoIdInProject,
    isLoadingProjects,
    handleProjectCreate,
    handleProjectSelect,
    handleProjectDelete,
    handleProjectRename,
  };
}
