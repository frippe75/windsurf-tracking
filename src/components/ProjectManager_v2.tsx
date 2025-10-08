import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Project } from "@/types/project";
import { ManagedVideo } from "@/types/video";
import { 
  FolderOpen, 
  Plus, 
  PlayCircle, 
  Trash2, 
  Video,
  CheckCircle2,
  Clock,
  Database,
  AlertCircle,
  FileVideo,
  Layers,
  Calendar
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProjectManager_v2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProject: Project | null;
  videos: ManagedVideo[];
  currentVideoId: string | null;
  onOpenAddResources: () => void;
  onOpenProjectSwitcher: () => void;
  onLoadVideo: (videoId: string) => void;
  onRemoveVideo: (videoId: string) => void;
}

export function ProjectManager_v2({
  open,
  onOpenChange,
  activeProject,
  videos,
  currentVideoId,
  onOpenAddResources,
  onOpenProjectSwitcher,
  onLoadVideo,
  onRemoveVideo,
}: ProjectManager_v2Props) {
  const getStatusIcon = (video: ManagedVideo) => {
    switch (video.status) {
      case "ready": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "downloading": return <Clock className="h-4 w-4 text-blue-500" />;
      case "syncing": return <Database className="h-4 w-4 text-yellow-500" />;
      case "error": return <AlertCircle className="h-4 w-4 text-red-500" />;
      default: return <FileVideo className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (video: ManagedVideo) => {
    switch (video.status) {
      case "ready": return "Ready";
      case "downloading": return `Downloading ${video.backendProgress || 0}%`;
      case "syncing": return `Syncing ${video.frontendProgress || 0}%`;
      case "error": return "Error";
      default: return "Unknown";
    }
  };

  const formatFileSize = (video: ManagedVideo) => {
    const bytes = video.metadata?.fileSize;
    if (!bytes) return "N/A";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "N/A";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const projectVideos = activeProject 
    ? videos.filter(v => activeProject.videoIds?.includes(v.id))
    : [];

  const videoCount = projectVideos.length;
  const annotationCount = activeProject?.annotations?.length || 0;
  const classCount = activeProject?.classes?.length || 0;
  const instanceCount = activeProject?.instances?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh]">
        {activeProject ? (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <DialogTitle>{activeProject.name}</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                      Active Project
                    </p>
                  </div>
                </div>
                <Button onClick={onOpenProjectSwitcher} variant="outline">
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Switch Project
                </Button>
              </div>
            </DialogHeader>

            <div className="flex-1 flex gap-6 min-h-0">
              {/* Left: Project Stats */}
              <div className="flex flex-col gap-4 w-64 flex-shrink-0">
                <div className="space-y-3">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Video className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Videos</span>
                    </div>
                    <p className="text-3xl font-bold">{videoCount}</p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Classes</span>
                    </div>
                    <p className="text-3xl font-bold">{classCount}</p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Instances</span>
                    </div>
                    <p className="text-3xl font-bold">{instanceCount}</p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Annotations</span>
                    </div>
                    <p className="text-3xl font-bold">{annotationCount}</p>
                  </Card>
                </div>

                <div className="mt-auto pt-4 border-t">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                    <Calendar className="h-3 w-3" />
                    <span>
                      Last modified {formatDistanceToNow(activeProject.lastModified, { addSuffix: true })}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{activeProject.id}</span>
                </div>
              </div>

              {/* Right: Videos in Project */}
              <div className="flex-1 flex flex-col gap-4 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Videos in Project</h3>
                  <Button onClick={onOpenAddResources}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Resources
                  </Button>
                </div>

                <ScrollArea className="flex-1">
                  <div className="space-y-2 pr-4">
                    {projectVideos.map((video) => {
                      const isCurrentVideo = video.id === currentVideoId;

                      return (
                        <Card
                          key={video.id}
                          className={`p-4 transition-all ${
                            isCurrentVideo 
                              ? 'border-blue-500 bg-blue-500/5' 
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            {/* Status Icon */}
                            <div className="mt-1">
                              {getStatusIcon(video)}
                            </div>

                            {/* Video Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-medium truncate">{video.filename}</h4>
                                {isCurrentVideo && (
                                  <Badge variant="default" className="bg-blue-500">
                                    <PlayCircle className="h-3 w-3 mr-1" />
                                    Currently Loaded
                                  </Badge>
                                )}
                              </div>

                              {video.metadata && (
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <span>{video.metadata.width}×{video.metadata.height}</span>
                                <span>{formatDuration(video.metadata.duration)}</span>
                                <span>{video.metadata.totalFrames} frames</span>
                                <span>{formatFileSize(video)}</span>
                                </div>
                              )}

                              {/* Progress bars for downloading/syncing */}
                              {(video.status === 'downloading' || video.status === 'syncing') && (
                                <div className="mt-2">
                                  <Progress 
                                    value={video.status === 'downloading' ? video.backendProgress : video.frontendProgress} 
                                  />
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {getStatusText(video)}
                                  </p>
                                </div>
                              )}

                              {video.status === 'error' && (
                                <p className="text-sm text-destructive mt-1">
                                  {video.error || 'Failed to process video'}
                                </p>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              {video.status === 'ready' && !isCurrentVideo && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onLoadVideo(video.id)}
                                >
                                  <PlayCircle className="h-4 w-4 mr-2" />
                                  Load
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onRemoveVideo(video.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}

                    {projectVideos.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <Video className="h-12 w-12 mx-auto mb-4 opacity-20" />
                        <p>No videos in this project</p>
                        <p className="text-sm mb-4">Add videos to start annotating</p>
                        <Button onClick={onOpenAddResources}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add Resources
                        </Button>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>No Active Project</DialogTitle>
            </DialogHeader>
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground">
              <FolderOpen className="h-16 w-16 mb-4 opacity-20" />
              <p className="mb-2">No project is currently active</p>
              <p className="text-sm mb-6">Create or open a project to get started</p>
              <Button onClick={onOpenProjectSwitcher}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Open Project
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
