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
 *
 * The upload / YouTube-download orchestration flows still live in the page
 * and mutate the library through setManagedVideos/addVideo.
 */

import { useEffect, useState } from "react";
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
 * Union the backend video list into the local library by video_id.
 * - Local entry exists → it wins (keeps youtube/progress/extra fields);
 *   only missing metadata is filled in from the backend.
 * - Backend-only video → appears as a ready library entry with API metadata.
 * - Local-only entries (in-flight uploads, temp entries) are kept as-is.
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

  // Merge the backend video list into the library on mount (offline tolerated)
  useEffect(() => {
    let cancelled = false;

    const syncFromBackend = async () => {
      try {
        const response = await api.getVideos();
        if (cancelled) return;
        setManagedVideos((prev) => mergeBackendVideos(prev, response.videos, now));
      } catch (error) {
        // Offline / backend down → keep the localStorage-only library
        console.warn("📚 Video library: backend list unavailable, using local library:", error);
      }
    };

    syncFromBackend();
    return () => {
      cancelled = true;
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

    for (const v of targets) {
      try {
        await videoCache.init();
        await videoCache.delete(v.filename);
      } catch {
        // IndexedDB purge is best-effort (entry may never have been cached)
      }
    }

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
