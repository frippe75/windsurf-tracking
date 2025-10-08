import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";
import { extractFrameFromVideo } from "@/lib/frameExtractor";
import { videoCache } from "@/lib/videoCache";
import { Skeleton } from "@/components/ui/skeleton";

// In-memory cache for extracted thumbnails
const thumbnailCache = new Map<string, string>();

interface SceneThumbnailProps {
  videoId: string;
  filename: string;
  startFrame: number;
  fps: number;
  width?: number;
  height?: number;
  eager?: boolean; // If true, load immediately without lazy loading
}

export function SceneThumbnail({
  videoId,
  filename,
  startFrame,
  fps,
  width = 60,
  height = 34,
  eager = false,
}: SceneThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const imgRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const cacheKey = `${videoId}_${startFrame}`;

  const extractThumbnail = async () => {
    // Check memory cache first
    const cached = thumbnailCache.get(cacheKey);
    if (cached) {
      setThumbnailUrl(cached);
      setIsLoading(false);
      return;
    }

    try {
      // Get video from local cache
      const cachedVideo = await videoCache.get(filename);
      if (!cachedVideo) {
        throw new Error('Video not in cache');
      }

      // Extract frame
      const dataUrl = await extractFrameFromVideo(
        cachedVideo.blob,
        startFrame,
        fps,
        width * 2, // 2x for retina
        height * 2
      );

      // Cache the result
      thumbnailCache.set(cacheKey, dataUrl);
      setThumbnailUrl(dataUrl);
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to extract thumbnail:', err);
      setError(true);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (eager) {
      // Load immediately
      extractThumbnail();
      return;
    }

    // Lazy load with IntersectionObserver
    if (!imgRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !thumbnailUrl && !error) {
            extractThumbnail();
            observerRef.current?.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Load slightly before entering viewport
      }
    );

    observerRef.current.observe(imgRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [eager, cacheKey]);

  return (
    <div
      ref={imgRef}
      className="relative flex-shrink-0 rounded border border-border overflow-hidden"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {isLoading && <Skeleton className="w-full h-full" />}
      
      {error && !isLoading && (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <Film className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      
      {thumbnailUrl && !error && (
        <img
          src={thumbnailUrl}
          alt={`Scene thumbnail frame ${startFrame}`}
          className="w-full h-full object-cover animate-in fade-in duration-200"
        />
      )}
    </div>
  );
}
