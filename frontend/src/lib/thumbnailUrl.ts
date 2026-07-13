import type { ManagedVideo } from "@/types/video";
import { extractYoutubeId } from "@/lib/youtubeUrl";
import { config } from "@/lib/config";

// Default thumbnail dimensions for the backend frame endpoint.
export const THUMBNAIL_WIDTH = 160;
export const THUMBNAIL_HEIGHT = 112;

/**
 * Build the backend frame-extraction URL for a video's first frame.
 * This is an OpenCV extraction on the backend (+ first-time S3 fetch), so it
 * is expensive and must only be requested when actually needed/visible.
 */
export function backendFrameThumbnailUrl(
  videoId: string,
  backendUrl: string,
  width: number = THUMBNAIL_WIDTH,
  height: number = THUMBNAIL_HEIGHT,
): string {
  return `${backendUrl}/api/videos/${videoId}/frame/0?width=${width}&height=${height}`;
}

/**
 * Resolve the thumbnail URL for a managed video.
 *
 * Priority:
 *  1. Cached YouTube thumbnail (already a remote image URL, no backend load).
 *  2. YouTube thumbnail derived from the video's URL (img.youtube.com).
 *  3. Backend frame extraction (expensive — OpenCV, first-time S3 fetch).
 *
 * `backendUrl` defaults to the runtime config so callers can omit it; tests
 * pass it explicitly to stay independent of config/import.meta.
 */
export function thumbnailUrl(
  video: Pick<ManagedVideo, "id" | "youtubeUrl" | "youtubeThumbnail">,
  backendUrl: string = config.backendUrl,
): string {
  if (video.youtubeThumbnail) {
    return video.youtubeThumbnail;
  }

  if (video.youtubeUrl) {
    const youtubeId = extractYoutubeId(video.youtubeUrl);
    if (youtubeId) {
      return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
    }
  }

  return backendFrameThumbnailUrl(video.id, backendUrl);
}

/**
 * True when resolving this video's thumbnail would hit the backend frame
 * endpoint (as opposed to a YouTube-hosted image). Useful for reasoning about
 * / testing which items cause backend load.
 */
export function isBackendThumbnail(
  video: Pick<ManagedVideo, "id" | "youtubeUrl" | "youtubeThumbnail">,
): boolean {
  if (video.youtubeThumbnail) return false;
  if (video.youtubeUrl && extractYoutubeId(video.youtubeUrl)) return false;
  return true;
}
