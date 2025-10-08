import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
import { config } from "@/lib/config";

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
  onRenameProject: (projectId: string, newName: string) => void;
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
  onRenameProject,
}: ProjectManager_v2Props) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const startEditingName = () => {
    if (activeProject) {
      setEditNameValue(activeProject.name);
      setIsEditingName(true);
    }
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setEditNameValue("");
  };

  const saveNameEdit = () => {
    const trimmed = editNameValue.trim();
    if (trimmed && activeProject && trimmed !== activeProject.name) {
      onRenameProject(activeProject.id, trimmed);
    }
    setIsEditingName(false);
    setEditNameValue("");
  };

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
      <DialogContent className="max-w-6xl h-[85vh] p-0">
        <DialogTitle className="sr-only">Project Manager</DialogTitle>
        {activeProject ? (
          <>
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditingName ? (
                      <Input
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onBlur={saveNameEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveNameEdit();
                          if (e.key === "Escape") cancelEditingName();
                        }}
                        className="h-7 text-lg font-semibold"
                        autoFocus
                      />
                    ) : (
                      <h2 
                        className="text-lg font-semibold cursor-pointer hover:text-primary transition-colors"
                        onClick={startEditingName}
                        title="Click to rename"
                      >
                        {activeProject.name}
                      </h2>
                    )}
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
            </div>

            <div className="flex-1 flex min-h-0 p-4 gap-4">
              {/* Left: Statistics */}
              <div className="flex-1 flex flex-col min-w-0 border border-border rounded-lg bg-card overflow-hidden">
                <div className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">Statistics</h3>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
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
                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <Calendar className="h-3 w-3" />
                      <span>
                        Last modified {formatDistanceToNow(activeProject.lastModified, { addSuffix: true })}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{activeProject.id}</span>
                  </div>
                  </div>
                </ScrollArea>
              </div>

              {/* Right: Videos */}
              <div className="flex-1 flex flex-col min-w-0 border border-border rounded-lg bg-card overflow-hidden">
                <div className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">Videos</h3>
                </div>

                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2">
                    {projectVideos.map((video) => {
                      const isCurrentVideo = video.id === currentVideoId;
                      const progress = video.status === 'downloading' 
                        ? video.backendProgress 
                        : video.status === 'syncing' 
                        ? video.frontendProgress 
                        : null;

                      return (
                        <div
                          key={video.id}
                          className={`
                            rounded-lg p-3 transition-all border
                            ${isCurrentVideo 
                              ? 'bg-primary/10 border-primary' 
                              : 'bg-card border-border hover:border-primary/50'
                            }
                          `}
                        >
                          <div className="flex items-start gap-3">
                            {/* Thumbnail */}
                            {video.status === 'ready' && video.metadata ? (
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
                            )}
                            
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2 mb-1">
                                <div className="mt-0.5 shrink-0">
                                  {getStatusIcon(video)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <p className="text-sm font-medium truncate">
                                      {video.filename}
                                    </p>
                                    {isCurrentVideo && (
                                      <Badge variant="default" className="text-xs">
                                        <PlayCircle className="h-3 w-3 mr-1" />
                                        Active
                                      </Badge>
                                    )}
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
                              {progress !== null && progress !== undefined && (
                                <div className="mt-2">
                                  <Progress value={progress} className="h-1" />
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {Math.round(progress)}%
                                  </p>
                                </div>
                              )}

                              {video.status === 'error' && (
                                <p className="text-xs text-destructive mt-1">
                                  {video.error || 'Failed to process'}
                                </p>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-1 shrink-0">
                              {video.status === 'ready' && !isCurrentVideo && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => onLoadVideo(video.id)}
                                  title="Load video"
                                >
                                  <PlayCircle className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => onRemoveVideo(video.id)}
                                title="Remove video"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {projectVideos.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <Video className="h-12 w-12 mx-auto mb-4 opacity-20" />
                        <p>No videos in this project</p>
                        <p className="text-sm">Add videos to start annotating</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                
                {/* Add button at bottom */}
                <div className="p-3 border-t border-border">
                  <Button onClick={onOpenAddResources} className="w-full" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Resources
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">No Active Project</h2>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground bg-card">
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
