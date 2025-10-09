import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ManagedVideo } from "@/types/video";
import { 
  Check, 
  Upload, 
  Youtube, 
  Database, 
  Clock, 
  PlayCircle,
  CheckCircle2,
  FileVideo,
  AlertCircle 
} from "lucide-react";

interface AddResourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectVideoIds: string[]; // Videos already in project
  availableVideos: ManagedVideo[]; // All videos in cache
  onAddToProject: (videoIds: string[]) => void;
  onFileSelect: (file: File) => void;
  onYoutubeUrl: (url: string) => void;
  isUploading: boolean;
}

export function AddResourcesDialog({
  open,
  onOpenChange,
  projectVideoIds,
  availableVideos,
  onAddToProject,
  onFileSelect,
  onYoutubeUrl,
  isUploading,
}: AddResourcesDialogProps) {
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");

  const handleAddSelected = () => {
    if (selectedVideoIds.length > 0) {
      onAddToProject(selectedVideoIds);
      setSelectedVideoIds([]);
      onOpenChange(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      e.target.value = "";
    }
  };

  const handleYoutubeSubmit = () => {
    if (youtubeUrl.trim()) {
      onYoutubeUrl(youtubeUrl.trim());
      setYoutubeUrl("");
    }
  };

  const toggleVideoSelection = (videoId: string) => {
    setSelectedVideoIds(prev =>
      prev.includes(videoId)
        ? prev.filter(id => id !== videoId)
        : [...prev, videoId]
    );
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex min-h-0 flex-col">
        <DialogHeader>
          <DialogTitle>Add Resources to Project</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="cache" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="cache">
              <Database className="h-4 w-4 mr-2" />
              Video Cache
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4 mr-2" />
              <span className="text-red-500">Upload</span>
            </TabsTrigger>
            <TabsTrigger value="youtube">
              <Youtube className="h-4 w-4 mr-2" />
              YouTube
            </TabsTrigger>
          </TabsList>

          {/* Cache Tab */}
          <TabsContent value="cache" className="flex-1 min-h-0 overflow-hidden flex flex-col p-0">
            <div className="flex items-center justify-between pb-4">
              <p className="text-sm text-muted-foreground">
                {availableVideos.length} videos in cache
              </p>
              {selectedVideoIds.length > 0 && (
                <Button onClick={handleAddSelected}>
                  Add {selectedVideoIds.length} Video{selectedVideoIds.length > 1 ? 's' : ''} to Project
                </Button>
              )}
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-2">
                {availableVideos.map((video) => {
                  const isInProject = projectVideoIds.includes(video.id);
                  const isSelected = selectedVideoIds.includes(video.id);
                  const canSelect = !isInProject && video.status === 'ready';

                  return (
                    <Card
                      key={video.id}
                      className={`p-4 cursor-pointer transition-colors ${
                        isInProject 
                          ? 'bg-muted/50 cursor-not-allowed' 
                          : isSelected 
                          ? 'border-primary bg-primary/5' 
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => canSelect && toggleVideoSelection(video.id)}
                    >
                      <div className="flex items-start gap-4">
                        {/* Selection Checkbox */}
                        <div className={`h-5 w-5 rounded border-2 flex items-center justify-center mt-1 ${
                          isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'
                        }`}>
                          {(isSelected || isInProject) && (
                            <Check className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>

                        {/* Video Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {getStatusIcon(video)}
                            <h4 className="font-medium truncate">{video.filename}</h4>
                            {isInProject && (
                              <Badge variant="secondary" className="ml-auto">
                                Already in Project
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
                      </div>
                    </Card>
                  );
                })}

                {availableVideos.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Database className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>No videos in cache</p>
                    <p className="text-sm">Upload or download videos to get started</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent value="upload" asChild>
            <label className="mx-auto my-auto flex flex-col items-center justify-center w-full max-w-md h-64 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="h-12 w-12 mb-4 text-muted-foreground" />
                <p className="mb-2 text-sm text-foreground font-medium">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-muted-foreground">
                  MP4, MOV, AVI, MKV (max 2GB)
                </p>
                {isUploading && (
                  <Badge variant="secondary" className="mt-4">
                    Uploading...
                  </Badge>
                )}
              </div>
              <input
                type="file"
                className="hidden"
                accept="video/*"
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </label>
          </TabsContent>

          {/* YouTube Tab */}
          <TabsContent value="youtube" className="flex-1 min-h-0 flex flex-col">
            <div className="">
              <div className="w-full max-w-md space-y-4">
                <div className="text-center mb-8">
                  <Youtube className="h-12 w-12 mx-auto mb-4 text-red-500" />
                  <h3 className="text-lg font-semibold mb-2">Download from YouTube</h3>
                  <p className="text-sm text-muted-foreground">
                    Paste a YouTube URL to download and add to your project
                  </p>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
                    disabled={isUploading}
                  />
                  <Button
                    onClick={handleYoutubeSubmit}
                    disabled={!youtubeUrl.trim() || isUploading}
                  >
                    Download
                  </Button>
                </div>

                {isUploading && (
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Downloading from YouTube...</p>
                    <Progress value={undefined} className="w-full" />
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
