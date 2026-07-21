/**
 * Persist a project's annotation state to the backend so work survives between
 * sessions (the debounced auto-saver calls this; hydration reads it back via
 * mergeBackendProjects).
 *
 * The subtlety: a project may or may not exist on the backend yet.
 *  - Video-select-created projects adopted the backend id (id === backend id).
 *  - Explicitly-created projects have only a local id and 404 on update.
 * So: try updating `backendProjectId ?? id`; on a 404 for a not-yet-backed
 * project that has a video, create the backend project and return its id for the
 * caller to store as `backendProjectId`. This backs both kinds without ever
 * duplicating an already-backed project.
 */
import type { Project } from "@/types/project";
import type { ProjectAnnotationState } from "@/hooks/useProjects";
import type {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
} from "@/lib/api";

export interface ProjectSyncApi {
  createProject: typeof apiCreateProject;
  updateProject: typeof apiUpdateProject;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /\b404\b|not found/i.test(err.message);
}

/**
 * Save the project's annotation state. Returns `{ backendProjectId }` only when a
 * backend project was newly created (so the caller can persist the mapping).
 */
export async function saveProjectToBackend(
  project: Project,
  state: ProjectAnnotationState,
  api: ProjectSyncApi,
): Promise<{ backendProjectId?: string }> {
  const settings = {
    classes: state.classes,
    instances: state.instances,
    annotations: state.annotations,
    keyframes: state.keyframes,
    scenes: state.scenes,
    tracks: state.tracks,
    metadataSchema: state.metadataSchema,
    videoMetadata: state.videoMetadata,
  };
  const targetId = project.backendProjectId ?? project.id;

  try {
    await api.updateProject(targetId, { name: project.name, settings });
    return {};
  } catch (err) {
    // Not yet backed (and has a video the backend requires) → create it once.
    if (isNotFound(err) && !project.backendProjectId && project.videoIds.length > 0) {
      const created = await api.createProject({
        name: project.name,
        video_id: project.videoIds[0],
        description: `Annotation project for ${project.name}`,
      });
      await api.updateProject(created.id, { name: project.name, settings });
      return { backendProjectId: created.id };
    }
    throw err;
  }
}
