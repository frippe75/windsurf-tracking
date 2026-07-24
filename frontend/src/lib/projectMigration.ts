import { Project } from "@/types/project";

/**
 * Parse and migrate the localStorage 'projects' payload.
 *
 * Migrations:
 * - legacy single `videoId` → `videoIds: string[]`
 * - missing `videoIds` → empty array
 * - legacy annotations without a `videoId` → stamped with the project's ORIGINAL (first) video.
 *   Annotations created before video-scoping have no owning clip, so in a multi-video project they
 *   bleed onto every other clip's frames. Videos are appended when added to a project, so
 *   `videoIds[0]` is always the video the project was created from — where those annotations were
 *   made. This runs once at hydration and persists back to storage on the next save.
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
    let p = project;
    if (p.videoId && !p.videoIds) {
      p = { ...p, videoIds: [p.videoId], videoId: undefined };
    } else if (!p.videoIds) {
      p = { ...p, videoIds: [] };
    }
    // Backfill annotation ownership to the project's founding clip.
    const primary: string | undefined = p.videoIds?.[0];
    if (primary && Array.isArray(p.annotations) && p.annotations.some((a: any) => !a.videoId)) {
      p = { ...p, annotations: p.annotations.map((a: any) => (a.videoId ? a : { ...a, videoId: primary })) };
    }
    return p;
  });
}
