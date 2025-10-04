import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, HardDrive, RefreshCw } from "lucide-react";
import { videoCache, type CacheStats } from "@/lib/videoCache";
import { useToast } from "@/hooks/use-toast";

interface VideoCacheManagerProps {
  currentVideoId?: string;
}

export function VideoCacheManager({ currentVideoId }: VideoCacheManagerProps) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadStats = async () => {
    setLoading(true);
    try {
      const cacheStats = await videoCache.getStats();
      setStats(cacheStats);
    } catch (error) {
      console.error("Failed to load cache stats:", error);
      toast({
        title: "Error loading cache",
        description: "Failed to load cache statistics",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleClearCache = async () => {
    try {
      await videoCache.clear();
      toast({
        title: "Cache cleared",
        description: "All cached videos have been removed",
      });
      loadStats();
    } catch (error) {
      console.error("Failed to clear cache:", error);
      toast({
        title: "Error clearing cache",
        description: "Failed to clear video cache",
        variant: "destructive",
      });
    }
  };

  const handleDeleteVideo = async (filename: string) => {
    try {
      await videoCache.delete(filename);
      toast({
        title: "Video removed",
        description: `${filename} removed from cache`,
      });
      loadStats();
    } catch (error) {
      console.error("Failed to delete video:", error);
      toast({
        title: "Error deleting video",
        description: "Failed to remove video from cache",
        variant: "destructive",
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <Card className="p-4 bg-card border-border">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Local Video Cache</h3>
        </div>
        <p className="text-xs text-muted-foreground">Loading cache information...</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center gap-2 mb-3">
        <HardDrive className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Local Video Cache</h3>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg mb-3">
        <div>
          <div className="text-sm font-semibold">{stats?.count || 0}</div>
          <div className="text-xs text-muted-foreground">Videos</div>
        </div>
        <div>
          <div className="text-sm font-semibold">{formatBytes(stats?.totalSize || 0)}</div>
          <div className="text-xs text-muted-foreground">Total Size</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-3">
        <Button
          variant="outline"
          size="sm"
          onClick={loadStats}
          className="flex items-center gap-1.5 text-xs h-8"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleClearCache}
          disabled={!stats || stats.count === 0}
          className="flex items-center gap-1.5 text-xs h-8"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear All
        </Button>
      </div>

      {/* Video List */}
      {stats && stats.videos.length > 0 ? (
        <ScrollArea className="h-[300px] w-full border rounded-md">
          <div className="p-2 space-y-1.5">
            {stats.videos.map((video) => {
              const isActive = currentVideoId && video.videoId === currentVideoId;
              return (
                <div
                  key={video.filename}
                  className={`flex items-center justify-between p-2 rounded-md relative ${
                    isActive
                      ? "bg-primary/5 border-l-4 border-l-primary border-r border-t border-b border-border"
                      : "bg-muted/50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{video.filename}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs h-5">
                        {formatBytes(video.size)}
                      </Badge>
                      <span className="text-xs">{formatDate(video.cachedAt)}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteVideo(video.filename)}
                    className="ml-2 h-7 w-7 p-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      ) : (
        <div className="text-center py-6 text-muted-foreground">
          <HardDrive className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No videos cached yet</p>
          <p className="text-xs">Upload a video to cache it locally</p>
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-muted-foreground p-2.5 bg-muted/30 rounded-md mt-3">
        <strong>About:</strong> Videos are stored in your browser's IndexedDB for instant loading.
        Cache may be cleared by the browser if storage is low.
      </div>
    </Card>
  );
}
