/**
 * Video source resolution: decide what URL the <video> element should play.
 *
 * Order:
 * 1. IndexedDB cache hit → object URL of the local blob (instant, seekable)
 * 2. Cache miss → presigned S3 URL (seekable; RGW honors Range) played
 *    immediately, while a background download fills the cache for next time
 * 3. stream-url failure → backend /download proxy as last resort
 *
 * Dependencies are injected so the decision flow is unit-testable.
 */

export interface VideoMetadata {
  duration: number;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
}

export interface VideoSourceDeps {
  getCached: (filename: string) => Promise<{ blob: Blob } | null>;
  cacheVideo: (
    filename: string,
    entry: { videoId: string; filename: string; blob: Blob; metadata: VideoMetadata & { cachedAt: number } }
  ) => Promise<void>;
  downloadVideo: (videoId: string) => Promise<Blob>;
  getStreamUrl: (videoId: string) => Promise<{ url: string; presigned: boolean }>;
  createObjectURL: (blob: Blob) => string;
  trackBlobUrl: (url: string) => void;
  fallbackUrl: (videoId: string) => string;
  now: () => number;
}

export async function resolveVideoSource(
  videoId: string,
  filename: string,
  metadata: VideoMetadata | undefined,
  deps: VideoSourceDeps
): Promise<string> {
  try {
    const cached = await deps.getCached(filename);
    if (cached) {
      console.log("💾 Video source: IndexedDB cache");
      const blobUrl = deps.createObjectURL(cached.blob);
      deps.trackBlobUrl(blobUrl);
      return blobUrl;
    }
  } catch (e) {
    console.warn("💾 Cache lookup failed:", e);
  }

  // Cache miss: fill the cache in the background (fire-and-forget)
  if (metadata) {
    (async () => {
      try {
        console.log("💾 Background-caching video:", filename);
        const blob = await deps.downloadVideo(videoId);
        await deps.cacheVideo(filename, {
          videoId,
          filename,
          blob,
          metadata: { ...metadata, cachedAt: deps.now() },
        });
        console.log("💾 Background cache complete:", filename);
      } catch (e) {
        console.warn("💾 Background cache failed:", e);
      }
    })();
  }

  // Play immediately from presigned S3 URL
  try {
    const stream = await deps.getStreamUrl(videoId);
    console.log(stream.presigned ? "🌐 Video source: presigned S3 URL" : "🌐 Video source: backend stream");
    return stream.url;
  } catch (e) {
    console.warn("🌐 stream-url failed, falling back to /download:", e);
    return deps.fallbackUrl(videoId);
  }
}
