import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Clock, Download, AlertCircle, Trash2, Upload, Youtube, Plus, Video as VideoIcon, Play } from "lucide-react";
import { config } from "@/lib/config";
import { ManagedVideo } from "@/types/video";
import { useToast } from "@/hooks/use-toast";

interface VideoManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videos: ManagedVideo[];
  activeVideoId: string | null;
  onVideoSelect: (videoId: string) => void;
  onVideoDelete: (videoId: string) => void;
  onFileSelect: (file: File) => void;
  onYoutubeUrl: (url: string) => void;
  isUploading: boolean;
}

export function VideoManager({
  open,
  onOpenChange,
  videos,
  activeVideoId,
  onVideoSelect,
  onVideoDelete,
  onFileSelect,
  onYoutubeUrl,
  isUploading,
}: VideoManagerProps) {
  const { toast } = useToast();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  const selectedVideo = videos.find(v => v.id === selectedVideoId);

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
        return 'Loading from web';
      case 'syncing':
        return 'Preparing';
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
        label: 'Loading from web...',
        step: `${video.backendProgress || 0}% downloaded`,
        percentage: Math.round(progress)
      };
    }
    if (video.status === 'syncing') {
      const progress = 60 + (video.frontendProgress || 0) * 0.4;
      return {
        value: progress,
        label: 'Preparing for editing...',
        step: 'Processing frames...',
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
  };

  const handleSwitchVideo = () => {
    if (selectedVideoId) {
      onVideoSelect(selectedVideoId);
      onOpenChange(false);
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 gap-0">
        <div className="flex h-full">
          {/* Left Pane: Video List */}
          <div className="w-[55%] border-r border-border flex flex-col">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold">My Videos</h2>
                <Badge variant="secondary">{videos.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Select or add a video</p>
            </div>

            <ScrollArea className="flex-1 px-4">
              <div className="py-4 space-y-2">
                {videos.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <VideoIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">No videos yet!</p>
                    <p className="text-xs text-muted-foreground">Add one to get started →</p>
                  </div>
                ) : (
                  videos.map((video) => {
                    const isActive = video.id === activeVideoId;
                    const isSelected = video.id === selectedVideoId;
                    const progress = getUnifiedProgress(video);

                    return (
                      <button
                        key={video.id}
                        onClick={() => handleVideoClick(video.id)}
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
                                  <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : ''}`}>
                                    {video.filename}
                                  </p>
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

            <div className="p-4 border-t border-border">
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setSelectedVideoId(null)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Video
              </Button>
            </div>
          </div>

          {/* Right Pane: Contextual Actions */}
          <div className="flex-1 flex flex-col">
            {selectedVideo ? (
              // Video selected - show details
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

                <ScrollArea className="flex-1">
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
                            <p className="text-sm font-medium text-destructive mb-1">Error Loading Video</p>
                            <p className="text-xs text-muted-foreground">
                              {selectedVideo.error || 'An unknown error occurred while processing this video.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              // No video selected - show add options
              <>
                <div className="p-6 border-b border-border">
                  <h3 className="text-lg font-semibold mb-1">Add a New Video</h3>
                  <p className="text-sm text-muted-foreground">Upload from your computer or download from YouTube</p>
                </div>

                <ScrollArea className="flex-1">
                  <div className="p-6 space-y-8">
                    {/* File Upload */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Upload className="h-5 w-5" />
                        <h4 className="font-semibold">Upload from Computer</h4>
                      </div>
                      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 hover:bg-accent/50 transition-all">
                        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                        <p className="text-sm font-medium mb-1">Drag & drop video here</p>
                        <p className="text-xs text-muted-foreground mb-3">or click to browse</p>
                        <label htmlFor="file-upload">
                          <Button variant="outline" asChild disabled={isUploading}>
                            <span>Choose File</span>
                          </Button>
                        </label>
                        <Input
                          id="file-upload"
                          type="file"
                          accept="video/*"
                          className="hidden"
                          onChange={handleFileChange}
                          disabled={isUploading}
                        />
                        <p className="text-xs text-muted-foreground mt-3">
                          Supports MP4, MOV, AVI, and other formats
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {/* YouTube URL */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Youtube className="h-5 w-5" />
                        <h4 className="font-semibold">Add from YouTube</h4>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="youtube-url">YouTube URL</Label>
                          <Input
                            id="youtube-url"
                            type="url"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={youtubeUrl}
                            onChange={(e) => setYoutubeUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !isUploading) {
                                handleYoutubeSubmit();
                              }
                            }}
                            disabled={isUploading}
                            className="h-12"
                          />
                        </div>

                        <Button
                          onClick={handleYoutubeSubmit}
                          disabled={isUploading || !youtubeUrl.trim()}
                          className="w-full"
                          size="lg"
                        >
                          <Youtube className="h-4 w-4 mr-2" />
                          {isUploading ? "Processing..." : "Download Video"}
                        </Button>

                        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                          <p className="text-xs font-medium">Note:</p>
                          <ul className="text-xs text-muted-foreground space-y-1">
                            <li>• Video will be downloaded and processed on the server</li>
                            <li>• This may take a few moments depending on video length</li>
                            <li>• Make sure you have permission to use the video content</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
