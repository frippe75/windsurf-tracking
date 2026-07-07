import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle2, 
  Clock, 
  Download, 
  AlertCircle, 
  Trash2, 
  PlayCircle,
  Youtube,
  FileVideo
} from "lucide-react";
import { config } from "@/lib/config";
import { ManagedVideo } from "@/types/video";

interface VideoListItemProps {
  video: ManagedVideo;
  
  // State flags
  isSelected?: boolean;
  isActive?: boolean;
  
  // Display options
  showThumbnail?: boolean;
  showProgress?: boolean;
  showYoutubeIcon?: boolean;
  
  // Action callbacks
  onClick?: (videoId: string) => void;
  onDelete?: (videoId: string) => void;
  onLoad?: (videoId: string) => void;
  
  // Button labels/titles
  deleteButtonTitle?: string;
  loadButtonTitle?: string;
  
  // Custom classNames
  className?: string;
}

export function VideoListItem({
  video,
  isSelected = false,
  isActive = false,
  showThumbnail = true,
  showProgress = true,
  showYoutubeIcon = true,
  onClick,
  onDelete,
  onLoad,
  deleteButtonTitle,
  loadButtonTitle = "Load video",
  className = "",
}: VideoListItemProps) {
  
  const getStatusIcon = (status: ManagedVideo['status']) => {
    switch (status) {
      case 'ready':
        return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />;
      case 'downloading':
      case 'syncing':
        return <Download className="h-4 w-4 text-blue-600 dark:text-blue-500 animate-pulse" />;
      case 'queued':
        return <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-500" />;
    }
  };

  const getStatusText = (video: ManagedVideo) => {
    switch (video.status) {
      case 'ready':
        return 'Ready';
      case 'downloading':
        return 'Downloading from YouTube...';
      case 'syncing':
        return 'Syncing to device...';
      case 'queued':
        return 'Queued';
      case 'error':
        return video.error || 'Error';
    }
  };

  const getUnifiedProgress = (video: ManagedVideo) => {
    if (video.status === 'downloading') {
      const progress = (video.backendProgress || 0) * 0.6;
      return {
        value: progress,
        percentage: Math.round(progress)
      };
    }
    if (video.status === 'syncing') {
      const progress = 60 + (video.frontendProgress || 0) * 0.4;
      return {
        value: progress,
        percentage: Math.round(progress)
      };
    }
    return null;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = showProgress ? getUnifiedProgress(video) : null;
  const showDeleteButton = onDelete && (
    video.status === 'downloading' || 
    video.status === 'syncing' || 
    video.status === 'error' ||
    (video.status === 'ready' && !isActive)
  );
  const showLoadButton = onLoad && video.status === 'ready' && !isActive;

  const handleClick = () => {
    if (onClick) {
      onClick(video.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(video.id);
    }
  };

  const handleLoad = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onLoad) {
      onLoad(video.id);
    }
  };

  return (
    <div
      className={`
        rounded-lg p-3 transition-all border relative
        ${isSelected 
          ? 'bg-primary/10 border-2 border-primary' 
          : 'bg-card border-border hover:border-primary/50'
        }
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {onClick && (
        <button
          onClick={handleClick}
          className="absolute inset-0"
          aria-label={`Select ${video.filename}`}
        />
      )}
      
      <div className="flex items-start gap-3 relative">
        {/* Thumbnail */}
        {showThumbnail && (
          video.status === 'ready' && video.metadata ? (
            <div className="w-20 h-14 rounded overflow-hidden bg-muted shrink-0">
              <img 
                src={`${config.backendUrl}/api/videos/${video.id}/frame/0?width=160&height=112`}
                alt={video.filename}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          ) : (
            <div className="w-20 h-14 rounded bg-muted shrink-0 flex items-center justify-center">
              <FileVideo className="h-6 w-6 text-muted-foreground/50" />
            </div>
          )
        )}
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-1">
            <div className="mt-0.5 shrink-0">
              {getStatusIcon(video.status)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : ''}`}>
                    {video.filename}
                  </p>
                  {showYoutubeIcon && video.youtubeUrl && (
                    <Youtube className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isActive && (
                    <Badge variant="default" className="text-xs">
                      <PlayCircle className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                </div>
              </div>
              
              {video.metadata ? (
                <p className="text-xs text-muted-foreground">
                  {video.metadata.width}×{video.metadata.height} • {formatDuration(video.metadata.duration)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {getStatusText(video)}
                </p>
              )}
            </div>
          </div>
          
          {/* Progress bar */}
          {progress && (
            <div className="mt-2">
              <Progress value={progress.value} className="h-1" />
              <p className="text-xs text-muted-foreground mt-1">
                {progress.percentage}%
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {(showDeleteButton || showLoadButton) && (
          <div className="flex gap-1 shrink-0 relative z-10">
            {showLoadButton && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleLoad}
                title={loadButtonTitle}
              >
                <PlayCircle className="h-4 w-4" />
              </Button>
            )}
            {showDeleteButton && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
                title={deleteButtonTitle || (video.status === 'error' ? 'Remove failed video' : video.status === 'ready' ? 'Delete video' : 'Cancel operation')}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
