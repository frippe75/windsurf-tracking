import { Project } from "@/types/project";

/**
 * Parse and migrate the localStorage 'projects' payload.
 *
 * Migrations:
 * - legacy single `videoId` → `videoIds: string[]`
 * - missing `videoIds` → empty array
 *
 * Malformed JSON (or null) yields an empty list — never throws.
 */
export function migrateStoredProjects(raw: string | null): Project[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map((project: any) => {
    if (project.videoId && !project.videoIds) {
      return { ...project, videoIds: [project.videoId], videoId: undefined };
    }
    if (!project.videoIds) {
      return { ...project, videoIds: [] };
    }
    return project;
  });
}
