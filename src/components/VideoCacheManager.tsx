import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, HardDrive, RefreshCw } from "lucide-react";
import { videoCache, type CacheStats } from "@/lib/videoCache";
import { useToast } from "@/hooks/use-toast";

export function VideoCacheManager() {
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
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Local Video Cache</CardTitle>
          <CardDescription>Loading cache information...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Local Video Cache
        </CardTitle>
        <CardDescription>
          Videos cached in your browser for instant loading
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div>
            <div className="text-2xl font-bold">{stats?.count || 0}</div>
            <div className="text-sm text-muted-foreground">Videos Cached</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{formatBytes(stats?.totalSize || 0)}</div>
            <div className="text-sm text-muted-foreground">Total Size</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadStats}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearCache}
            disabled={!stats || stats.count === 0}
            className="flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Clear All
          </Button>
        </div>

        {/* Video List */}
        {stats && stats.videos.length > 0 ? (
          <ScrollArea className="h-[300px] w-full border rounded-md">
            <div className="p-4 space-y-2">
              {stats.videos.map((video) => (
                <div
                  key={video.filename}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{video.filename}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {formatBytes(video.size)}
                      </Badge>
                      <span className="text-xs">{formatDate(video.cachedAt)}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteVideo(video.filename)}
                    className="ml-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <HardDrive className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No videos cached yet</p>
            <p className="text-sm">Upload a video to cache it locally</p>
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded-md">
          <strong>About the cache:</strong> Videos are stored in your browser's IndexedDB
          to enable instant loading. Cache data may be cleared by the browser if storage
          is low. Cached videos are only stored locally and do not sync across devices.
        </div>
      </CardContent>
    </Card>
  );
}
