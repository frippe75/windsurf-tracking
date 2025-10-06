import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  CheckCircle2, Clock, Download, AlertCircle, Trash2, Upload, Youtube, 
  Plus, Video as VideoIcon, Play, FolderOpen, Edit3, FileText, Calendar,
  Layers, Target, GitBranch, Film
} from "lucide-react";
import { config } from "@/lib/config";
import { ManagedVideo } from "@/types/video";
import { Project, getProjectMetrics } from "@/types/project";
import { useToast } from "@/hooks/use-toast";

interface ProjectManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  videos: ManagedVideo[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectDelete: (projectId: string) => void;
  onProjectRename: (projectId: string, newName: string) => void;
  onVideoSelect: (videoId: string) => void;
  onVideoDelete: (videoId: string) => void;
  onFileSelect: (file: File) => void;
  onYoutubeUrl: (url: string) => void;
  isUploading: boolean;
}

export function ProjectManager({
  open,
  onOpenChange,
  projects,
  videos,
  activeProjectId,
  onProjectSelect,
  onProjectDelete,
  onProjectRename,
  onVideoSelect,
  onVideoDelete,
  onFileSelect,
  onYoutubeUrl,
  isUploading,
}: ProjectManagerProps) {
  const { toast } = useToast();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [editingProjectName, setEditingProjectName] = useState<string | null>(null);
  const [projectNameInput, setProjectNameInput] = useState("");

  const selectedProject = projects.find(p => p.id === selectedProjectId);

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
        return 'Error';
    }
  };

  const getUnifiedProgress = (video: ManagedVideo) => {
    if (video.status === 'downloading') {
      const progress = (video.backendProgress || 0) * 0.6;
      return {
        value: progress,
        label: 'Downloading from YouTube...',
        step: `${video.backendProgress || 0}% downloaded`,
        percentage: Math.round(progress)
      };
    }
    if (video.status === 'syncing') {
      const progress = 60 + (video.frontendProgress || 0) * 0.4;
      return {
        value: progress,
        label: 'Syncing to device...',
        step: `${video.frontendProgress || 0}% synced`,
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

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatRelativeTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const handleProjectClick = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveTab("overview");
  };

  const handleSwitchProject = () => {
    if (selectedProjectId) {
      onProjectSelect(selectedProjectId);
      onOpenChange(false);
    }
  };

  const handleAddVideo = () => {
    setSelectedProjectId(null);
    setActiveTab("videos");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      e.target.value = "";
    }
  };

  const handleYoutubeSubmit = () => {
    if (!youtubeUrl.trim()) {
      toast({
        title: "URL Required",
        description: "Please enter a YouTube URL",
        variant: "destructive",
      });
      return;
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    if (!youtubeRegex.test(youtubeUrl)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid YouTube URL",
        variant: "destructive",
      });
      return;
    }

    onYoutubeUrl(youtubeUrl);
    setYoutubeUrl("");
  };

  const startEditingName = (project: Project) => {
    setEditingProjectName(project.id);
    setProjectNameInput(project.name);
  };

  const saveProjectName = () => {
    if (editingProjectName && projectNameInput.trim()) {
      onProjectRename(editingProjectName, projectNameInput.trim());
    }
    setEditingProjectName(null);
  };

  const cancelEditingName = () => {
    setEditingProjectName(null);
    setProjectNameInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] p-0 gap-0">
        <DialogTitle className="sr-only">Project Manager</DialogTitle>
        <DialogDescription className="sr-only">Manage projects and videos</DialogDescription>
        <div className="flex h-full">
          {/* Left Pane: Projects List */}
          <div className="w-[45%] border-r border-border flex flex-col h-full overflow-hidden">
            <div className="p-6 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold">My Projects</h2>
                <Badge variant="secondary">{projects.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Select or create a project</p>
            </div>

            <div className="flex-1 min-h-0">
              <ScrollArea className="h-full px-4">
                <div className="py-4 space-y-2">
                  {projects.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <FolderOpen className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm font-medium text-muted-foreground mb-1">No projects yet!</p>
                      <p className="text-xs text-muted-foreground">Add a video to create your first project →</p>
                    </div>
                  ) : (
                    projects.map((project) => {
                      const isActive = project.id === activeProjectId;
                      const isSelected = project.id === selectedProjectId;
                      const metrics = getProjectMetrics(project);
                      const video = videos.find(v => v.id === project.videoId);

                      return (
                        <button
                          key={project.id}
                          onClick={() => handleProjectClick(project.id)}
                          className={`
                            w-full text-left rounded-lg p-3 transition-all
                            ${isSelected 
                              ? 'bg-primary/10 border-2 border-primary' 
                              : 'bg-card border border-border hover:border-primary/50'
                            }
                          `}
                        >
                          <div className="flex items-start gap-3">
                            {/* Thumbnail */}
                            {video?.status === 'ready' && video?.metadata ? (
                              <div className="w-20 h-14 rounded overflow-hidden bg-muted shrink-0">
                                <img 
                                  src={`${config.backendUrl}/api/videos/${project.videoId}/frame/0?width=160&height=112`}
                                  alt={project.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="w-20 h-14 rounded bg-muted shrink-0 flex items-center justify-center">
                                <FolderOpen className="h-6 w-6 text-muted-foreground/50" />
                              </div>
                            )}
                            
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : ''}`}>
                                  {project.name}
                                </p>
                                {isActive && (
                                  <Badge variant="default" className="shrink-0 text-xs">Active</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mb-1.5">
                                {metrics.totalInstances} instances • {metrics.totalAnnotations} annotations
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatRelativeTime(project.lastModified)}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="p-4 border-t border-border shrink-0">
              <Button 
                variant="outline" 
                className="w-full"
                onClick={handleAddVideo}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Video
              </Button>
            </div>
          </div>

          {/* Right Pane: Tabs */}
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col h-full">
              <div className="border-b border-border shrink-0">
                <TabsList className="w-full justify-start rounded-none h-12 bg-transparent p-0">
                  <TabsTrigger 
                    value="overview" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                    disabled={!selectedProject}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger 
                    value="videos" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                  >
                    <VideoIcon className="h-4 w-4 mr-2" />
                    Videos
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Overview Tab */}
              <TabsContent value="overview" className="flex-1 m-0 overflow-hidden">
                {selectedProject ? (
                  <ScrollArea className="h-full">
                    <div className="p-6 space-y-6">
                      {/* Project Header */}
                      <div>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1 min-w-0">
                            {editingProjectName === selectedProject.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  value={projectNameInput}
                                  onChange={(e) => setProjectNameInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveProjectName();
                                    if (e.key === 'Escape') cancelEditingName();
                                  }}
                                  className="text-lg font-semibold"
                                  autoFocus
                                />
                                <Button size="sm" onClick={saveProjectName}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={cancelEditingName}>Cancel</Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <h3 className="text-2xl font-semibold truncate">{selectedProject.name}</h3>
                                <Button 
                                  size="icon" 
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => startEditingName(selectedProject)}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                            <p className="text-sm text-muted-foreground mt-1">
                              {selectedProject.videoFilename}
                            </p>
                          </div>
                          {selectedProject.id !== activeProjectId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onProjectDelete(selectedProject.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span>Created {new Date(selectedProject.createdAt).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>Modified {formatRelativeTime(selectedProject.lastModified)}</span>
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Project Statistics */}
                      <div>
                        <h4 className="text-sm font-semibold mb-3">Project Statistics</h4>
                        <div className="grid grid-cols-2 gap-3">
                          {(() => {
                            const metrics = getProjectMetrics(selectedProject);
                            return (
                              <>
                                <Card>
                                  <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                      <CardDescription>Classes</CardDescription>
                                      <Layers className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="text-2xl font-bold">{metrics.totalClasses}</div>
                                  </CardContent>
                                </Card>
                                <Card>
                                  <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                      <CardDescription>Instances</CardDescription>
                                      <Target className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="text-2xl font-bold">{metrics.totalInstances}</div>
                                  </CardContent>
                                </Card>
                                <Card>
                                  <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                      <CardDescription>Annotations</CardDescription>
                                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="text-2xl font-bold">{metrics.totalAnnotations}</div>
                                  </CardContent>
                                </Card>
                                <Card>
                                  <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                      <CardDescription>Scenes</CardDescription>
                                      <Film className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="text-2xl font-bold">{metrics.totalScenes}</div>
                                  </CardContent>
                                </Card>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      <Separator />

                      {/* Actions */}
                      <div className="space-y-3">
                        {selectedProject.id !== activeProjectId ? (
                          <Button 
                            onClick={handleSwitchProject}
                            className="w-full"
                            size="lg"
                          >
                            <Play className="h-4 w-4 mr-2" />
                            Switch to This Project
                          </Button>
                        ) : (
                          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
                            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-primary" />
                            <p className="text-sm font-medium">Currently Active</p>
                            <p className="text-xs text-muted-foreground mt-1">This project is loaded in the editor</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex items-center justify-center h-full p-6">
                    <div className="text-center">
                      <FolderOpen className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
                      <p className="text-sm font-medium text-muted-foreground mb-1">No project selected</p>
                      <p className="text-xs text-muted-foreground">Select a project from the list or add a video</p>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Videos Tab */}
              <TabsContent value="videos" className="flex-1 m-0 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-6 space-y-6">
                    {/* Upload Local File */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Upload className="h-5 w-5" />
                          Upload Local File
                        </CardTitle>
                        <CardDescription>
                          Select a video file from your device
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2">
                          <Input
                            type="file"
                            accept="video/*"
                            onChange={handleFileChange}
                            disabled={isUploading}
                            className="flex-1"
                          />
                        </div>
                        {isUploading && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Uploading video...
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* YouTube Download */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Youtube className="h-5 w-5 text-red-500" />
                          Download from YouTube
                        </CardTitle>
                        <CardDescription>
                          Enter a YouTube video URL
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2">
                          <Input
                            placeholder="https://youtube.com/watch?v=..."
                            value={youtubeUrl}
                            onChange={(e) => setYoutubeUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleYoutubeSubmit();
                            }}
                          />
                          <Button onClick={handleYoutubeSubmit}>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Separator />

                    {/* Video List */}
                    <div>
                      <h4 className="text-sm font-semibold mb-3">Available Videos</h4>
                      <div className="space-y-2">
                        {videos.length === 0 ? (
                          <div className="text-center py-8 px-4 border-2 border-dashed rounded-lg">
                            <VideoIcon className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">No videos uploaded yet</p>
                          </div>
                        ) : (
                          videos.map((video) => {
                            const progress = getUnifiedProgress(video);
                            const project = projects.find(p => p.videoId === video.id);

                            return (
                              <Card key={video.id}>
                                <CardContent className="p-4">
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
                                        <VideoIcon className="h-6 w-6 text-muted-foreground/50" />
                                      </div>
                                    )}

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-start gap-2 mb-1">
                                        {getStatusIcon(video.status)}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium truncate">{video.filename}</p>
                                            {video.youtubeUrl && (
                                              <Youtube className="h-3.5 w-3.5 text-red-500 shrink-0" />
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
                                          {project && (
                                            <p className="text-xs text-primary mt-1">
                                              Used in: {project.name}
                                            </p>
                                          )}
                                        </div>
                                      </div>
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
                                    {video.status === 'ready' && !project && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => onVideoDelete(video.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
