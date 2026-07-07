import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, Video as VideoIcon, Play, Upload, Youtube, CheckCircle2, AlertCircle } from "lucide-react";
import { ManagedVideo } from "@/types/video";
import { useToast } from "@/hooks/use-toast";
import { VideoListItem } from "@/components/VideoListItem";

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
        <DialogTitle className="sr-only">Video Manager</DialogTitle>
        <DialogDescription className="sr-only">Manage and select videos</DialogDescription>
        <div className="flex h-full">
          {/* Left Pane: Video List */}
          <div className="w-[55%] border-r border-border flex flex-col h-full overflow-hidden">
            <div className="p-6 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold">My Videos</h2>
                <Badge variant="secondary">{videos.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Select or add a video</p>
            </div>

            <div className="flex-1 min-h-0">
              <ScrollArea className="h-full px-4">
                <div className="py-4 space-y-2">
                {videos.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <VideoIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">No videos yet!</p>
                    <p className="text-xs text-muted-foreground">Add one to get started →</p>
                  </div>
                ) : (
                  videos.map((video) => (
                    <VideoListItem
                      key={video.id}
                      video={video}
                      isSelected={video.id === selectedVideoId}
                      isActive={video.id === activeVideoId}
                      showThumbnail
                      showProgress
                      showYoutubeIcon
                      onClick={handleVideoClick}
                      onDelete={onVideoDelete}
                    />
                  ))
                )}
                </div>
              </ScrollArea>
            </div>

            <div className="p-4 border-t border-border shrink-0">
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
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {selectedVideo ? (
              // Video selected - show details
              <>
                <div className="p-6 border-b border-border">
                  <VideoListItem
                    video={selectedVideo}
                    isActive={selectedVideo.id === activeVideoId}
                    showThumbnail={false}
                    showProgress={false}
                    onDelete={onVideoDelete}
                    className="border-0 p-0 bg-transparent hover:border-0"
                  />
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
