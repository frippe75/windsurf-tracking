import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Clock, Download, AlertCircle, Trash2 } from "lucide-react";
import { ManagedVideo } from "@/types/video";

interface VideoManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videos: ManagedVideo[];
  activeVideoId: string | null;
  onVideoSelect: (videoId: string) => void;
  onVideoDelete: (videoId: string) => void;
}

export function VideoManager({
  open,
  onOpenChange,
  videos,
  activeVideoId,
  onVideoSelect,
  onVideoDelete,
}: VideoManagerProps) {
  const getStatusIcon = (status: ManagedVideo['status']) => {
    switch (status) {
      case 'ready':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'downloading':
      case 'syncing':
        return <Download className="h-4 w-4 text-blue-500 animate-pulse" />;
      case 'queued':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusText = (video: ManagedVideo) => {
    switch (video.status) {
      case 'ready':
        return 'Ready';
      case 'downloading':
        return 'Loading from web...';
      case 'syncing':
        return 'Preparing for editing...';
      case 'queued':
        return 'Queued';
      case 'error':
        return video.error || 'Error';
    }
  };

  const getTotalProgress = (video: ManagedVideo) => {
    if (video.status === 'downloading' && video.backendProgress !== undefined) {
      // Backend download is 0-60% of total
      return (video.backendProgress / 100) * 60;
    }
    if (video.status === 'syncing' && video.frontendProgress !== undefined) {
      // Frontend sync is 60-100% of total
      return 60 + (video.frontendProgress / 100) * 40;
    }
    return undefined;
  };

  const handleVideoClick = (videoId: string, status: ManagedVideo['status']) => {
    if (status === 'ready') {
      onVideoSelect(videoId);
      onOpenChange(false); // Close dialog after selection
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>My Videos ({videos.length})</DialogTitle>
          <DialogDescription>
            Select a video to edit or manage your video library
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[500px] pr-4">
          {videos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No videos yet</p>
              <p className="text-sm mt-2">Upload a file or add a YouTube link to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {videos.map((video) => {
                const isActive = video.id === activeVideoId;
                const totalProgress = getTotalProgress(video);

                return (
                  <div
                    key={video.id}
                    className={`
                      border rounded-lg p-4 transition-all
                      ${isActive ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'}
                      ${video.status === 'ready' ? 'cursor-pointer' : 'cursor-default'}
                    `}
                    onClick={() => handleVideoClick(video.id, video.status)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatusIcon(video.status)}
                          <h3 className={`font-medium truncate ${isActive ? 'text-primary' : ''}`}>
                            {video.filename}
                          </h3>
                          {isActive && (
                            <Badge variant="default" className="ml-auto">Active</Badge>
                          )}
                        </div>

                        <div className="text-sm text-muted-foreground mb-2">
                          {video.metadata && (
                            <div>
                              {video.metadata.width}×{video.metadata.height} • {video.metadata.totalFrames.toLocaleString()} frames
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span>{getStatusText(video)}</span>
                          </div>
                        </div>

                        {totalProgress !== undefined && (
                          <div className="mt-3">
                            <Progress value={totalProgress} className="h-2" />
                            <div className="text-xs text-muted-foreground mt-1">
                              {Math.round(totalProgress)}%
                            </div>
                          </div>
                        )}
                      </div>

                      {video.status === 'ready' && !isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            onVideoDelete(video.id);
                          }}
                          className="shrink-0"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
