import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Clock, Download, AlertCircle, Trash2, Upload, Youtube, Plus, Video as VideoIcon, Play, FileText, Filter, FolderOpen } from "lucide-react";
import { config } from "@/lib/config";
import { ManagedVideo } from "@/types/video";
import { useToast } from "@/hooks/use-toast";

interface ProjectManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videos: ManagedVideo[];
  activeVideoId: string | null;
  onVideoSelect: (videoId: string) => void;
  onVideoDelete: (videoId: string) => void;
  onFileSelect: (file: File) => void;
  onYoutubeUrl: (url: string) => void;
  isUploading: boolean;
  hasUnsavedChanges?: boolean;
}

export function ProjectManager({
  open,
  onOpenChange,
  videos,
  activeVideoId,
  onVideoSelect,
  onVideoDelete,
  onFileSelect,
  onYoutubeUrl,
  isUploading,
  hasUnsavedChanges = false,
}: ProjectManagerProps) {
  const { toast } = useToast();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [videoFilter, setVideoFilter] = useState<"all" | "youtube" | "uploaded">("all");
  const [currentTab, setCurrentTab] = useState<"project" | "overview" | "videos">("project");
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingSwitchVideoId, setPendingSwitchVideoId] = useState<string | null>(null);

  const selectedVideo = videos.find(v => v.id === selectedVideoId);

  // Auto-redirect to Videos tab if no active project
  useEffect(() => {
    if (open && !activeVideoId) {
      setCurrentTab("videos");
    } else if (open && activeVideoId) {
      setCurrentTab("project");
    }
  }, [open, activeVideoId]);

  // Filter videos based on source
  const filteredVideos = videos.filter(video => {
    if (videoFilter === "all") return true;
    if (videoFilter === "youtube") return !!video.youtubeUrl;
    if (videoFilter === "uploaded") return !video.youtubeUrl;
    return true;
  });

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

  const handleVideoClick = (videoId: string) => {
    setSelectedVideoId(videoId);
    setCurrentTab("overview");
  };

  const handleSwitchVideo = () => {
    if (!selectedVideoId) return;

    // Check for unsaved changes
    if (hasUnsavedChanges && selectedVideoId !== activeVideoId) {
      setPendingSwitchVideoId(selectedVideoId);
      setShowUnsavedWarning(true);
      return;
    }

    // Proceed with switch
    proceedWithSwitch(selectedVideoId);
  };

  const proceedWithSwitch = (videoId: string) => {
    onVideoSelect(videoId);
    onOpenChange(false);
    setShowUnsavedWarning(false);
    setPendingSwitchVideoId(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      // Don't close dialog - let user see upload progress
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl h-[85vh] p-0 gap-0">
          <DialogTitle className="sr-only">Project Manager</DialogTitle>
          <DialogDescription className="sr-only">Manage videos and projects</DialogDescription>
          <div className="flex h-full">
            {/* Left Pane: Video List */}
            <div className="w-[55%] border-r border-border flex flex-col h-full min-h-0 overflow-hidden">
              <div className="p-6 border-b border-border shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">My Videos</h2>
                  <Badge variant="secondary">{videos.length}</Badge>
                </div>
                
                {/* Filter Dropdown */}
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={videoFilter} onValueChange={(v: any) => setVideoFilter(v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Videos</SelectItem>
                      <SelectItem value="youtube">YouTube Videos</SelectItem>
                      <SelectItem value="uploaded">Uploaded Videos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <ScrollArea className="h-0 flex-1 px-4" type="auto">
                <div className="py-4 space-y-2 max-w-full overflow-hidden">
                  {filteredVideos.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <VideoIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        {videoFilter === "all" ? "No videos yet!" : `No ${videoFilter} videos`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {videoFilter === "all" ? "Add one to get started →" : "Try a different filter"}
                      </p>
                    </div>
                  ) : (
                    filteredVideos.map((video) => {
                    const isActive = video.id === activeVideoId;
                    const isSelected = video.id === selectedVideoId;
                    const progress = getUnifiedProgress(video);

                    return (
                      <button
                        key={video.id}
                        onClick={() => handleVideoClick(video.id)}
                        className={`
                          w-full max-w-full text-left rounded-lg p-3 transition-all overflow-hidden
                          ${isSelected 
                            ? 'bg-primary/10 border-2 border-primary' 
                            : 'bg-card border border-border hover:border-primary/50'
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
                              <VideoIcon className="h-6 w-6 text-muted-foreground/50" />
                            </div>
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
                                    {video.youtubeUrl && (
                                      <Youtube className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                    )}
                                  </div>
                                  {isActive && (
                                    <Badge variant="default" className="shrink-0 text-xs">Active</Badge>
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
                            {progress && (
                              <div className="mt-2">
                                <Progress value={progress.value} className="h-1" />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {progress.percentage}%
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
                  </div>
                </ScrollArea>
              </div>

            {/* Right Pane: Tabs */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <Tabs value={currentTab} onValueChange={(v: any) => setCurrentTab(v)} className="flex-1 flex flex-col">
                <TabsList className="grid w-full grid-cols-3 rounded-none border-b shrink-0">
                  <TabsTrigger value="project" disabled={!activeVideoId}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Project
                  </TabsTrigger>
                  <TabsTrigger value="overview" disabled={!selectedVideo}>
                    <FileText className="h-4 w-4 mr-2" />
                    Video Details
                  </TabsTrigger>
                  <TabsTrigger value="videos">
                    <VideoIcon className="h-4 w-4 mr-2" />
                    Videos
                  </TabsTrigger>
                </TabsList>

                {/* Project Tab */}
                <TabsContent value="project" className="flex-1 m-0 overflow-hidden">
                  {activeVideoId && (
                    <>
                      <div className="p-6 border-b border-border">
                        <h3 className="text-lg font-semibold mb-2">Current Project</h3>
                        <p className="text-sm text-muted-foreground">
                          Active project overview and actions
                        </p>
                      </div>

                      <ScrollArea className="flex-1" type="auto">
                        <div className="p-6 space-y-6">
                          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                            <CheckCircle2 className="h-6 w-6 mb-2 text-primary" />
                            <p className="text-sm font-medium mb-1">Project Active</p>
                            <p className="text-xs text-muted-foreground">
                              Currently editing: {videos.find(v => v.id === activeVideoId)?.filename}
                            </p>
                          </div>

                          <Separator />

                          <div>
                            <h4 className="text-sm font-semibold mb-3">Switch Video</h4>
                            <p className="text-xs text-muted-foreground mb-3">
                              Select a different video from the list to switch projects
                            </p>
                            <Button 
                              variant="outline" 
                              className="w-full"
                              onClick={() => setCurrentTab("videos")}
                            >
                              <VideoIcon className="h-4 w-4 mr-2" />
                              Browse Videos
                            </Button>
                          </div>
                        </div>
                      </ScrollArea>
                    </>
                  )}
                </TabsContent>

                {/* Video Details Tab (was Overview) */}
                <TabsContent value="overview" className="flex-1 m-0 overflow-hidden">
                {selectedVideo && (
                  <>
                    <div className="p-6 border-b border-border">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 min-w-0 mr-4">
                          <h3 className="text-lg font-semibold truncate mb-1">
                            {selectedVideo.filename}
                          </h3>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(selectedVideo.status)}
                            <span className="text-sm text-muted-foreground">
                              {getStatusText(selectedVideo)}
                            </span>
                          </div>
                        </div>
                        {selectedVideo.status === 'ready' && selectedVideo.id !== activeVideoId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onVideoDelete(selectedVideo.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <ScrollArea className="flex-1" type="auto">
                      <div className="p-6 space-y-6">
                        {selectedVideo.status === 'ready' && selectedVideo.metadata && (
                          <>
                            <div>
                              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <Play className="h-4 w-4" />
                                Video Details
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between py-2 border-b border-border">
                                  <span className="text-muted-foreground">Resolution</span>
                                  <span className="font-medium">{selectedVideo.metadata.width} × {selectedVideo.metadata.height}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-border">
                                  <span className="text-muted-foreground">Duration</span>
                                  <span className="font-medium">{formatDuration(selectedVideo.metadata.duration)}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-border">
                                  <span className="text-muted-foreground">Total Frames</span>
                                  <span className="font-medium">{selectedVideo.metadata.totalFrames.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-border">
                                  <span className="text-muted-foreground">Frame Rate</span>
                                  <span className="font-medium">{selectedVideo.metadata.fps.toFixed(2)} fps</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-border">
                                  <span className="text-muted-foreground">File Size</span>
                                  <span className="font-medium">{formatFileSize(selectedVideo.metadata.fileSize)}</span>
                                </div>
                                {selectedVideo.youtubeUrl && (
                                  <div className="flex justify-between py-2 border-b border-border">
                                    <span className="text-muted-foreground">Source</span>
                                    <a 
                                      href={selectedVideo.youtubeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-primary hover:underline flex items-center gap-1"
                                    >
                                      <Youtube className="h-3 w-3" />
                                      YouTube
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                              {selectedVideo.id !== activeVideoId ? (
                                <Button 
                                  onClick={handleSwitchVideo}
                                  className="w-full"
                                  size="lg"
                                >
                                  <Play className="h-4 w-4 mr-2" />
                                  Switch to This Video
                                </Button>
                              ) : (
                                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
                                  <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-primary" />
                                  <p className="text-sm font-medium">Currently Active</p>
                                  <p className="text-xs text-muted-foreground mt-1">This video is loaded in the editor</p>
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {(selectedVideo.status === 'downloading' || selectedVideo.status === 'syncing') && (
                          <div className="space-y-4">
                            {(() => {
                              const progress = getUnifiedProgress(selectedVideo);
                              return progress ? (
                                <>
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <h4 className="text-sm font-semibold">{progress.label}</h4>
                                      <span className="text-sm font-medium">{progress.percentage}%</span>
                                    </div>
                                    <Progress value={progress.value} className="h-2 mb-2" />
                                    <p className="text-xs text-muted-foreground">{progress.step}</p>
                                  </div>
                                  
                                  <div className="bg-muted rounded-lg p-4 space-y-2">
                                    <p className="text-xs font-medium">Processing Video</p>
                                    <p className="text-xs text-muted-foreground">
                                      This may take a few moments depending on the video size. You can close this dialog and come back later.
                                    </p>
                                  </div>
                                </>
                              ) : null;
                            })()}
                          </div>
                        )}

                        {selectedVideo.status === 'error' && (
                          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-medium text-destructive mb-1">Processing Error</p>
                                <p className="text-xs text-muted-foreground">
                                  An error occurred while processing this video. Please try uploading again.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </TabsContent>

                {/* Videos Tab */}
                <TabsContent value="videos" className="flex-1 m-0 overflow-hidden">
                  <ScrollArea className="h-full" type="auto">
                    <div className="p-6 space-y-6">
                    {/* Upload Section */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        Upload Video File
                      </h3>
                      <div className="space-y-3">
                        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                          <input
                            type="file"
                            id="video-upload"
                            accept="video/*"
                            className="hidden"
                            onChange={handleFileChange}
                            disabled={isUploading}
                          />
                          <label htmlFor="video-upload" className="cursor-pointer">
                            <VideoIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm font-medium mb-1">
                              {isUploading ? "Uploading..." : "Click to upload video"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              MP4, WebM, or other video formats
                            </p>
                          </label>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* YouTube Section */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Youtube className="h-4 w-4" />
                        Add from YouTube
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="youtube-url">YouTube URL</Label>
                          <Input
                            id="youtube-url"
                            type="url"
                            placeholder="https://youtube.com/watch?v=..."
                            value={youtubeUrl}
                            onChange={(e) => setYoutubeUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
                          />
                        </div>
                        <Button 
                          onClick={handleYoutubeSubmit}
                          className="w-full"
                          disabled={!youtubeUrl.trim()}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download from YouTube
                        </Button>
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

      {/* Unsaved Changes Warning */}
      <AlertDialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in your current project. Switching videos will discard these changes. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowUnsavedWarning(false);
              setPendingSwitchVideoId(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingSwitchVideoId) {
                proceedWithSwitch(pendingSwitchVideoId);
              }
            }}>
              Switch Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
