import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Clock, Download, AlertCircle, Trash2, Upload, Youtube, Video as VideoIcon } from "lucide-react";
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
  const [selectedTab, setSelectedTab] = useState<"library" | "add">("library");
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      onOpenChange(false);
      // Reset input
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

    // Basic YouTube URL validation
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
    onOpenChange(false);
    setYoutubeUrl("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Video Manager</DialogTitle>
          <DialogDescription>
            Manage your video library and add new videos
          </DialogDescription>
        </DialogHeader>

        <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as "library" | "add")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library">
              <VideoIcon className="h-4 w-4 mr-2" />
              My Videos ({videos.length})
            </TabsTrigger>
            <TabsTrigger value="add">
              <Upload className="h-4 w-4 mr-2" />
              Add Video
            </TabsTrigger>
          </TabsList>

          {/* Library Tab */}
          <TabsContent value="library" className="mt-4">
            <ScrollArea className="h-[450px] pr-4">
              {videos.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <VideoIcon className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="font-medium">No videos yet</p>
                  <p className="text-sm mt-2">Switch to "Add Video" tab to get started</p>
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
          </TabsContent>

          {/* Add Video Tab */}
          <TabsContent value="add" className="mt-4">
            <Tabs defaultValue="upload" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upload">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload File
                </TabsTrigger>
                <TabsTrigger value="youtube">
                  <Youtube className="h-4 w-4 mr-2" />
                  YouTube Link
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="file-upload">Select Video File</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                    <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-4">
                      Click to browse or drag and drop
                    </p>
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
                    <p className="text-xs text-muted-foreground mt-2">
                      Supports MP4, MOV, AVI, and other common formats
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="youtube" className="space-y-4 mt-4">
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
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter a YouTube video URL to download and process
                  </p>
                </div>

                <Button
                  onClick={handleYoutubeSubmit}
                  disabled={isUploading || !youtubeUrl.trim()}
                  className="w-full"
                >
                  <Youtube className="h-4 w-4 mr-2" />
                  {isUploading ? "Processing..." : "Download from YouTube"}
                </Button>

                <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-medium">Note:</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Video will be downloaded and processed on the server</li>
                    <li>This may take a few moments depending on video length</li>
                    <li>Make sure you have permission to use the video content</li>
                  </ul>
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
