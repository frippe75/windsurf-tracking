/**
 * Video library domain, extracted from pages/Index.tsx.
 *
 * Owns:
 * - `managedVideos` + localStorage 'managedVideos' persistence
 * - add/remove video handlers (delete is guarded by project usage, injected)
 * - backend merge on mount (fix): the library used to be localStorage-only,
 *   so videos uploaded from another browser/session (or wiped local state)
 *   never appeared. Now getVideos() is merged in on mount — union by
 *   video_id, backend-only videos appear as ready with metadata from the
 *   API, local entries keep their extra fields (youtube info, progress,
 *   timestamps), and a backend failure is tolerated (offline → localStorage
 *   only).
 * - backend prune (follow-the-DB): the merge used to only ever *add*, so a
 *   video deleted from the backend (here or from another browser) lingered
 *   forever as a stale "ready" entry pointing at a gone video, with its cached
 *   blob still in IndexedDB. Now a successful getVideos() also prunes local
 *   `ready` entries absent from the backend list and purges their blob, so
 *   local storage follows the DB. The sync re-runs when the tab regains focus,
 *   so a cross-browser delete is picked up without a full reload. In-flight
 *   entries (queued/downloading/syncing) and the offline path are never pruned
 *   — absence there means "not uploaded yet" or "unreachable", not "deleted".
 *
 * The upload / YouTube-download orchestration flows still live in the page
 * and mutate the library through setManagedVideos/addVideo.
 */

import { useEffect, useRef, useState } from "react";
import { ManagedVideo } from "@/types/video";
import { getVideos as apiGetVideos, type VideoInfoResponse } from "@/lib/api";
import { videoCache } from "@/lib/videoCache";
import type { ToastOptions } from "@/hooks/useProjects";

export interface VideoLibraryApi {
  getVideos: typeof apiGetVideos;
}

export interface UseVideoLibraryOptions {
  toast: (options: ToastOptions) => void;
  /** How many projects currently reference a video (guards deletion). */
  countProjectsUsingVideo: (videoId: string) => number;
  /** Injectable API client (tests); defaults to lib/api. */
  api?: VideoLibraryApi;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

const defaultApi: VideoLibraryApi = { getVideos: apiGetVideos };

/**
 * Heal the local library on page load. A download's progress poll does not
 * survive a reload, so any entry persisted as `downloading`/`syncing` is stale
 * and would otherwise sit frozen forever (e.g. "Syncing 41%"). On load:
 *  - if the backend has a video with the same filename, the download finished
 *    (backend reconciles from S3) — drop the stale entry; the backend's ready
 *    copy represents it (added by mergeBackendVideos).
 *  - otherwise the download never completed — drop the orphan too.
 * Ready/error entries are untouched.
 */
export function reconcileStaleProgress(local: ManagedVideo[]): ManagedVideo[] {
  return local.filter((v) => v.status !== "downloading" && v.status !== "syncing");
}

/**
 * Union the backend video list into the local library by video_id.
 * - Local entry exists → it wins (keeps youtube/progress/extra fields);
 *   only missing metadata is filled in from the backend.
 * - Backend-only video → appears as a ready library entry with API metadata.
 * - Local-only entries (in-flight uploads) are kept as-is.
 */
export function mergeBackendVideos(
  local: ManagedVideo[],
  backendVideos: VideoInfoResponse[],
  now: () => number = Date.now
): ManagedVideo[] {
  const merged = [...local];

  for (const bv of backendVideos) {
    const metadata = {
      duration: bv.duration,
      fps: bv.fps,
      width: bv.width,
      height: bv.height,
      totalFrames: bv.total_frames,
      fileSize: bv.file_size,
    };

    const existingIdx = merged.findIndex((v) => v.id === bv.video_id);
    if (existingIdx >= 0) {
      const existing = merged[existingIdx];
      // Local entry wins; only fill in metadata the local copy lacks
      if (!existing.metadata) {
        merged[existingIdx] = { ...existing, metadata };
      }
    } else {
      merged.push({
        id: bv.video_id,
        filename: bv.filename,
        status: "ready",
        metadata,
        isActive: false,
        createdAt: now(),
        lastAccessedAt: now(),
      });
    }
  }

  return merged;
}

/**
 * Split the local library into the entries that survive a backend sync and the
 * ones deleted from the backend. A local `ready` entry whose video_id is absent
 * from a *successfully fetched* backend list was removed on the server (here or
 * from another browser) → it's stale and should be dropped, its cached blob
 * purged. Two guards keep this from deleting videos that were never deleted:
 *
 *  - Only `ready` entries are candidates: queued/downloading/syncing entries
 *    are in-flight uploads/downloads not yet on the backend, and `error`
 *    entries never landed there — absence doesn't mean deletion for those.
 *  - `prunableIds`, when given, restricts pruning to ids the client has already
 *    seen on the backend (persisted entries + anything a prior sync confirmed).
 *    A freshly-uploaded video not yet reflected in getVideos() is thus NOT in
 *    the set and is protected from a racing prune. Omit the set to prune every
 *    absent `ready` entry.
 *
 * Pure: callers purge the IndexedDB blobs of `removed` themselves.
 */
export function pruneDeletedBackendVideos(
  local: ManagedVideo[],
  backendVideos: VideoInfoResponse[],
  prunableIds?: ReadonlySet<string>
): { kept: ManagedVideo[]; removed: ManagedVideo[] } {
  const backendIds = new Set(backendVideos.map((bv) => bv.video_id));
  const kept: ManagedVideo[] = [];
  const removed: ManagedVideo[] = [];
  for (const v of local) {
    const deleted =
      v.status === "ready" && !backendIds.has(v.id) && (!prunableIds || prunableIds.has(v.id));
    if (deleted) {
      removed.push(v);
    } else {
      kept.push(v);
    }
  }
  return { kept, removed };
}

/** Best-effort purge of the IndexedDB blob for each video (by filename). */
async function purgeCachedBlobs(videos: ManagedVideo[]): Promise<void> {
  for (const v of videos) {
    try {
      await videoCache.init();
      await videoCache.delete(v.filename);
    } catch {
      // IndexedDB purge is best-effort (entry may never have been cached)
    }
  }
}

export function useVideoLibrary(options: UseVideoLibraryOptions) {
  const { toast, countProjectsUsingVideo } = options;
  const api = options.api ?? defaultApi;
  const now = options.now ?? Date.now;

  // Load persisted video library from localStorage
  const [managedVideos, setManagedVideos] = useState<ManagedVideo[]>(() => {
    try {
      const saved = localStorage.getItem("managedVideos");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Persist managed videos to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("managedVideos", JSON.stringify(managedVideos));
    } catch (error) {
      console.error("Failed to save managed videos:", error);
    }
  }, [managedVideos]);

  // Latest library snapshot for the sync effect (which runs with empty deps and
  // on focus, so it must read current state without re-subscribing).
  const managedVideosRef = useRef(managedVideos);
  useEffect(() => {
    managedVideosRef.current = managedVideos;
  }, [managedVideos]);

  // Ids the client has confirmed on the backend: persisted entries (they were
  // saved because they were backend-backed) plus every id a successful sync
  // returns. Only these are eligible for prune-on-delete — a just-uploaded
  // video not yet listed by getVideos() is absent here and so protected from a
  // racing prune. `useRef(fn)` seeds it exactly once from the initial library.
  const knownBackendIdsRef = useRef<Set<string>>(new Set(managedVideos.map((v) => v.id)));

  // Sync the library against the backend: add backend-only videos, and prune
  // local `ready` entries that are gone from the backend (deleted here or from
  // another browser) — purging their cached blob so storage follows the DB.
  // Runs on mount and whenever the tab regains focus, so a cross-browser delete
  // is picked up without a full reload.
  useEffect(() => {
    let disposed = false;

    // healStale: on mount, drop in-flight entries whose progress poll died on
    // reload. On a focus re-sync the polls are still live, so leave them alone.
    const syncFromBackend = async (healStale: boolean) => {
      let backendVideos: VideoInfoResponse[];
      try {
        backendVideos = (await api.getVideos()).videos;
      } catch (error) {
        // Offline / backend down → never prune (can't tell deleted from
        // unreachable). Only heal stale in-flight entries, and only on mount.
        console.warn("📚 Video library: backend list unavailable, using local library:", error);
        if (!disposed && healStale) setManagedVideos((prev) => reconcileStaleProgress(prev));
        return;
      }
      if (disposed) return;

      // Everything the backend just returned is now "known" for future syncs.
      for (const bv of backendVideos) knownBackendIdsRef.current.add(bv.video_id);

      // Compute prunes from the latest snapshot so we can purge blobs + toast
      // outside the (pure) state updater. Only known ids are prunable, so a
      // just-uploaded video the backend hasn't listed yet is left alone.
      const base = healStale
        ? reconcileStaleProgress(managedVideosRef.current)
        : managedVideosRef.current;
      const { removed } = pruneDeletedBackendVideos(base, backendVideos, knownBackendIdsRef.current);
      const removedIds = new Set(removed.map((v) => v.id));

      if (removed.length) {
        await purgeCachedBlobs(removed);
        if (disposed) return;
        toast({
          title: `Removed ${removed.length} deleted video${removed.length !== 1 ? "s" : ""}`,
          description: "No longer on the server — cleared from your local cache.",
        });
      }

      if (disposed) return;
      setManagedVideos((prev) => {
        const healed = healStale ? reconcileStaleProgress(prev) : prev;
        const pruned = removedIds.size ? healed.filter((v) => !removedIds.has(v.id)) : healed;
        return mergeBackendVideos(pruned, backendVideos, now);
      });
    };

    syncFromBackend(true);

    const onVisible = () => {
      if (document.visibilityState === "visible") syncFromBackend(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addVideo = (video: ManagedVideo) => {
    setManagedVideos((prev) => [...prev, video]);
  };

  const handleVideoDelete = (videoId: string) => {
    // Check if video is used by any project
    const projectsUsingVideo = countProjectsUsingVideo(videoId);
    if (projectsUsingVideo > 0) {
      toast({
        title: "Cannot delete video",
        description: `This video is used by ${projectsUsingVideo} project(s). Delete the project(s) first.`,
        variant: "destructive",
      });
      return;
    }

    // Remove from managed videos
    setManagedVideos((prev) => prev.filter((v) => v.id !== videoId));

    toast({
      title: "Video deleted",
      description: "Video has been removed",
    });
  };

  // Bulk-remove videos from the local cache + library. Used by the resources
  // dialog's "Delete" action — also clears stuck downloading/syncing entries.
  // Purges the IndexedDB blob too. Does not touch backend S3.
  const deleteVideosFromCache = async (videoIds: string[]) => {
    const ids = new Set(videoIds);
    const targets = managedVideos.filter((v) => ids.has(v.id));

    await purgeCachedBlobs(targets);

    setManagedVideos((prev) => prev.filter((v) => !ids.has(v.id)));

    toast({
      title: `Removed ${targets.length} video${targets.length !== 1 ? "s" : ""}`,
      description: "Cleared from the local cache.",
    });
  };

  return {
    managedVideos,
    setManagedVideos,
    addVideo,
    handleVideoDelete,
    deleteVideosFromCache,
  };
}
