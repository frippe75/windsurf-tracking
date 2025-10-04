import { useState, useEffect, useCallback } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { ClassManager } from "@/components/ClassManager";
import { KeyframeManager } from "@/components/KeyframeManager";
import { HierarchicalTimeline } from "@/components/HierarchicalTimeline";
import { ScenesManager } from "@/components/ScenesManager";
import { Toolbox, type ToolMode } from "@/components/Toolbox";
import { ContextMenu } from "@/components/ContextMenu";
import { TrackingJobs, type TrackingJob } from "@/components/TrackingJobs";
import { VideoCacheManager } from "@/components/VideoCacheManager";
import { MetadataEditor } from "@/components/MetadataEditor";
import { MetadataModal } from "@/components/MetadataModal";
import { DownloadQueue, type DownloadJob } from "@/components/DownloadQueue";
import { VideoManager } from "@/components/VideoManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Upload, Keyboard, Save, Download, Video } from "lucide-react";
import { Class, Instance, Annotation, Keyframe, Scene } from "@/types/annotation";
import { ManagedVideo } from "@/types/video";
import { detectObjects, uploadVideo, detectScenes, checkBackendHealth, createTrackingJob, executeTrackingJob, getTrackingJobStatus, getTrackingJobResults, segmentWithSAM2, getVideoInfo, checkVideoExists, downloadFromYouTube, getYouTubeDownloadStatus, type SubJob } from "@/lib/api";
import { videoCache } from "@/lib/videoCache";
import { BackendSelector } from "@/components/BackendSelector";

import { config } from "@/lib/config";

const SAIL_COLORS = [
  { hex: "hsl(142, 71%, 45%)", name: "Green" },
  { hex: "hsl(217, 91%, 60%)", name: "Blue" },
  { hex: "hsl(25, 95%, 53%)", name: "Orange" },
  { hex: "hsl(271, 81%, 56%)", name: "Purple" },
  { hex: "hsl(48, 96%, 53%)", name: "Yellow" },
];

const Index = () => {
  const { toast } = useToast();
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [videoId, setVideoId] = useState<string>("");
  const [videoNativeWidth, setVideoNativeWidth] = useState<number>(1280);
  const [videoNativeHeight, setVideoNativeHeight] = useState<number>(720);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [backendStatus, setBackendStatus] = useState<"checking" | "healthy" | "offline">("checking");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(3000);
  const [classes, setClasses] = useState<Class[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>();
  const [isDetectingScenes, setIsDetectingScenes] = useState(false);
  const [overlays, setOverlays] = useState({
    segments: true,
    bboxes: true,
    points: true,
  });
  const [colorIndex, setColorIndex] = useState(0);
  const [selectedTool, setSelectedTool] = useState<ToolMode>("annotate");
  const [autoTrack, setAutoTrack] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);
  const [useSAM2, setUseSAM2] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    context: any;
  } | null>(null);
  const [trackingJobs, setTrackingJobs] = useState<TrackingJob[]>([]);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [maximizeVideo, setMaximizeVideo] = useState(false);
  const [videoMetadata, setVideoMetadata] = useState<Record<string, string>>({});
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [metadataModal, setMetadataModal] = useState<{
    isOpen: boolean;
    frame?: number;
    initialText?: string;
  }>({ isOpen: false });
  const [downloadQueue, setDownloadQueue] = useState<DownloadJob[]>([]);
  const [videoManagerOpen, setVideoManagerOpen] = useState(false);
  const [managedVideos, setManagedVideos] = useState<ManagedVideo[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Frame range for timeline (defaults to full video, or zooms to selected scene)
  const frameRange: [number, number] = selectedScene 
    ? [selectedScene.startFrame, selectedScene.endFrame]
    : [0, totalFrames];

  // 🎬 DEBUG: Component lifecycle logging
  useEffect(() => {
    console.log("🎬 Index component mounted");
    return () => {
      console.log("🎬 Index component unmounting");
    };
  }, []);

  // 🎬 DEBUG: Watch videoUrl changes
  useEffect(() => {
    console.log("🎬 videoUrl changed:", videoUrl ? `SET (length: ${videoUrl.length})` : "CLEARED");
  }, [videoUrl]);

  // 🎬 DEBUG: Watch videoId changes
  useEffect(() => {
    console.log("🎬 videoId changed:", videoId ? `SET (${videoId})` : "CLEARED");
  }, [videoId]);

  // 🔍 DEBUG: Render-time state check
  useEffect(() => {
    if (!videoUrl && !videoId) {
      console.log("⚠️ Render check: Both videoUrl and videoId are empty!");
    } else {
      console.log("🔍 Render check: videoUrl exists:", !!videoUrl, "videoId exists:", !!videoId);
    }
  });

  // Check backend health periodically
  useEffect(() => {
    const checkHealth = async () => {
      const health = await checkBackendHealth();
      const newStatus = health && health.status === "healthy" ? "healthy" : "offline";
      
      // Only show toast if status changed
      setBackendStatus((prevStatus) => {
        if (prevStatus !== "checking" && prevStatus !== newStatus) {
          toast({
            title: newStatus === "healthy" ? "Backend connected" : "Backend offline",
            description: newStatus === "healthy" 
              ? `${health!.message} v${health!.version}`
              : "Upload and scene detection unavailable.",
            variant: newStatus === "healthy" ? "default" : "destructive",
          });
        } else if (prevStatus === "checking") {
          // First check - always show status
          toast({
            title: newStatus === "healthy" ? "Backend connected" : "Backend offline",
            description: newStatus === "healthy" 
              ? `${health!.message} v${health!.version}`
              : "Running in offline mode.",
            variant: newStatus === "healthy" ? "default" : "destructive",
          });
        }
        return newStatus;
      });
    };
    
    // Initial check
    checkHealth();
    
    // Check every 5 seconds
    const interval = setInterval(checkHealth, 5000);
    
    return () => clearInterval(interval);
  }, [toast]);

  // Auto-create tracking jobs from START->STOP keyframe pairs
  useEffect(() => {
    const sortedKeyframes = [...keyframes].sort((a, b) => a.frame - b.frame);
    const updatedJobs = new Map(trackingJobs.map(job => [job.id, job]));
    
    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].type === "START") {
        const startFrame = sortedKeyframes[i].frame;
        const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");
        
        if (stopKeyframe) {
          const jobId = `segment-${startFrame}-${stopKeyframe.frame}`;
          
          // Find all annotations that exist in this segment
          const segmentAnnotations = annotations
            .filter(ann => ann.frameCreated >= startFrame && ann.frameCreated <= stopKeyframe.frame)
            .map(ann => ann.id);
          
          // Update existing job or create new one
          const existingJob = updatedJobs.get(jobId);
          if (existingJob) {
            // Update objectIds if new annotations were added
            updatedJobs.set(jobId, {
              ...existingJob,
              objectIds: segmentAnnotations,
            });
          } else {
            // Create new job
            updatedJobs.set(jobId, {
              id: jobId,
              startFrame,
              stopFrame: stopKeyframe.frame,
              objectIds: segmentAnnotations,
              status: "pending",
            });
          }
        }
      }
    }
    
    // Remove jobs for segments that no longer have START->STOP pairs
    const validJobIds = new Set<string>();
    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].type === "START") {
        const startFrame = sortedKeyframes[i].frame;
        const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");
        if (stopKeyframe) {
          validJobIds.add(`segment-${startFrame}-${stopKeyframe.frame}`);
        }
      }
    }
    
    // Filter out invalid jobs (keep only valid ones and those that are processing/completed)
    const finalJobs = Array.from(updatedJobs.values()).filter(
      job => validJobIds.has(job.id) || job.status !== "pending"
    );
    
    // Only update state if jobs actually changed
    if (JSON.stringify(finalJobs) !== JSON.stringify(trackingJobs)) {
      setTrackingJobs(finalJobs);
    }
  }, [keyframes, annotations, trackingJobs]);

  // Auto-detect DINO on frame change
  useEffect(() => {
    if (autoDetect && videoUrl) {
      // TODO: Call DINO detection API
      console.log("Auto-detecting objects at frame", currentFrame);
    }
  }, [currentFrame, autoDetect, videoUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Close context menu on ESC
      if (e.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        // Deselect annotation in edit mode
        if (selectedAnnotationId) {
          setSelectedAnnotationId(undefined);
          return;
        }
      }
      
      // Delete key to delete selected annotation/instance
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnotationId) {
        e.preventDefault();
        const annotation = annotations.find(ann => ann.id === selectedAnnotationId);
        if (annotation) {
          handleDeleteInstance(annotation.instanceId);
          setSelectedAnnotationId(undefined);
        }
        return;
      }
      
      // Ignore if typing in input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Tab cycling through annotations (only in edit mode)
      if (e.key === "Tab" && selectedTool === "edit") {
        e.preventDefault();
        const currentFrameAnnotations = annotations.filter(ann => 
          ann.frameCreated === currentFrame
        );
        
        if (currentFrameAnnotations.length === 0) return;
        
        const currentIndex = selectedAnnotationId 
          ? currentFrameAnnotations.findIndex(ann => ann.id === selectedAnnotationId)
          : -1;
        
        let nextIndex;
        if (e.shiftKey) {
          // Shift+Tab: cycle backwards
          nextIndex = currentIndex <= 0 
            ? currentFrameAnnotations.length - 1 
            : currentIndex - 1;
        } else {
          // Tab: cycle forwards
          nextIndex = currentIndex >= currentFrameAnnotations.length - 1 
            ? 0 
            : currentIndex + 1;
        }
        
        setSelectedAnnotationId(currentFrameAnnotations[nextIndex].id);
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          // Toggle play/pause
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            setCurrentFrame((f) => Math.max(0, f - 30));
          } else {
            setCurrentFrame((f) => Math.max(0, f - 1));
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            setCurrentFrame((f) => Math.min(totalFrames, f + 30));
          } else {
            setCurrentFrame((f) => Math.min(totalFrames, f + 1));
          }
          break;
        case "s":
        case "S":
          e.preventDefault();
          handleAddKeyframe("START");
          break;
        case "e":
        case "E":
          e.preventDefault();
          handleAddKeyframe("STOP");
          break;
        case "x":
        case "X":
          e.preventDefault();
          handleAddKeyframe("SKIP");
          break;
        case "t":
        case "T":
          e.preventDefault();
          handleAddKeyframe("META");
          break;
        case "v":
          e.preventDefault();
          setSelectedTool("select");
          break;
        case "a":
          e.preventDefault();
          setSelectedTool("annotate");
          break;
        case "m":
          e.preventDefault();
          setSelectedTool("edit");
          break;
        case "1":
        case "2":
        case "3":
          e.preventDefault();
          const overlayKey = ["segments", "bboxes", "points"][parseInt(e.key) - 1] as keyof typeof overlays;
          handleToggleOverlay(overlayKey);
          break;
        case "4":
          e.preventDefault();
          setShowLabels(prev => !prev);
          break;
      }

      // Save project
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveProject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [totalFrames, currentFrame, keyframes, selectedTool, annotations, selectedAnnotationId]);

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processVideoFile(file);
  };

  const handleYoutubeUrl = async (url: string) => {
    try {
      console.log("📺 Initiating YouTube download:", url);
      
      // Initiate download
      const downloadJob = await downloadFromYouTube({ url });
      const jobId = downloadJob.job_id;
      
      // Create managed video entry (downloading state)
      const tempVideo: ManagedVideo = {
        id: jobId,
        filename: "Loading...",
        status: 'downloading',
        backendProgress: 0,
        isActive: false,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      setManagedVideos(prev => [...prev, tempVideo]);
      
      // Add to queue
      const newDownload: DownloadJob = {
        id: jobId,
        url,
        status: downloadJob.status,
        progress: 0,
      };
      setDownloadQueue(prev => [...prev, newDownload]);

      toast({
        title: "Download started",
        description: "Video will appear in your library when ready",
      });

      // Poll for status in background
      pollDownloadStatus(jobId, url);

    } catch (error: any) {
      console.error("📺 YouTube download error:", error);
      toast({
        title: "Download failed",
        description: error?.message || "Could not start download",
        variant: "destructive",
      });
    }
  };

  const pollDownloadStatus = async (jobId: string, url: string) => {
    let pollCount = 0;
    const maxPolls = 180; // 6 minutes max

    while (pollCount < maxPolls) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      pollCount++;

      try {
        const statusResponse = await getYouTubeDownloadStatus(jobId);
        
        // Update queue
        setDownloadQueue(prev => prev.map(d => 
          d.id === jobId 
            ? {
                ...d,
                status: statusResponse.status,
                progress: statusResponse.progress || 0,
                current_step: statusResponse.current_step,
                video_id: statusResponse.video_id,
              }
            : d
        ));

        // Update managed video progress
        setManagedVideos(prev => prev.map(v => 
          v.id === jobId
            ? {
                ...v,
                status: statusResponse.status === 'completed' ? 'ready' : 
                        statusResponse.current_step === 'syncing' ? 'syncing' : 'downloading',
                backendProgress: statusResponse.current_step === 'downloading' ? statusResponse.progress : 100,
                frontendProgress: statusResponse.current_step === 'syncing' ? statusResponse.progress : undefined,
                filename: statusResponse.filename || v.filename,
              }
            : v
        ));

        // Handle completion
        if (statusResponse.status === 'completed' && statusResponse.video_id) {
          console.log("📺 Download completed! video_id:", statusResponse.video_id);
          
          // Get full video info
          const videoInfo = await getVideoInfo(statusResponse.video_id);
          
          // Update managed video with final video_id and metadata
          setManagedVideos(prev => prev.map(v =>
            v.id === jobId ? {
              id: statusResponse.video_id!,
              filename: videoInfo.filename,
              status: 'ready' as const,
              metadata: {
                duration: videoInfo.duration,
                fps: videoInfo.fps,
                width: videoInfo.width,
                height: videoInfo.height,
                totalFrames: videoInfo.total_frames,
                fileSize: videoInfo.file_size,
              },
              isActive: false,
              createdAt: v.createdAt,
              lastAccessedAt: Date.now(),
            } : v
          ));
          
          toast({
            title: "Video ready",
            description: `${videoInfo.filename} is now available in your library`,
          });
          
          // Remove from queue after successful load
          setTimeout(() => {
            setDownloadQueue(prev => prev.filter(d => d.id !== jobId));
          }, 2000);
          
          break;
        }

        // Handle failure
        if (statusResponse.status === 'failed') {
          setDownloadQueue(prev => prev.map(d => 
            d.id === jobId ? { ...d, error: 'Download failed' } : d
          ));
          toast({
            title: "Download failed",
            description: "The video could not be downloaded",
            variant: "destructive",
          });
          break;
        }

      } catch (error) {
        console.error("📺 Polling error:", error);
        break;
      }
    }

    // Handle timeout
    if (pollCount >= maxPolls) {
      setDownloadQueue(prev => prev.map(d => 
        d.id === jobId ? { ...d, status: 'failed' as const, error: 'Download timed out' } : d
      ));
    }
  };

  const handleCancelDownload = async (jobId: string) => {
    // TODO: Call backend cancel endpoint when available
    setDownloadQueue(prev => prev.filter(d => d.id !== jobId));
    toast({
      title: "Download cancelled",
    });
  };

  const handleRemoveDownload = (jobId: string) => {
    setDownloadQueue(prev => prev.filter(d => d.id !== jobId));
  };

  const handleVideoSelect = (videoId: string) => {
    const video = managedVideos.find(v => v.id === videoId);
    if (!video || video.status !== 'ready') return;

    // Clear current editing context
    setAnnotations([]);
    setInstances([]);
    setKeyframes([]);
    setScenes([]);
    setSelectedClassId(undefined);
    setSelectedAnnotationId(undefined);
    setSelectedScene(null);
    setTrackingJobs([]);
    setCurrentFrame(0);
    setVideoMetadata({});

    // Set new video as active
    setActiveVideoId(videoId);
    setVideoId(videoId);
    setVideoUrl(`${config.backendUrl}/api/videos/${videoId}/frame/0`);
    
    if (video.metadata) {
      setVideoNativeWidth(video.metadata.width);
      setVideoNativeHeight(video.metadata.height);
      setTotalFrames(video.metadata.totalFrames);
    }

    // Update last accessed time
    setManagedVideos(prev => prev.map(v =>
      v.id === videoId ? { ...v, isActive: true, lastAccessedAt: Date.now() } : { ...v, isActive: false }
    ));

    toast({
      title: "Video loaded",
      description: video.filename,
    });
  };

  const handleVideoDelete = (videoId: string) => {
    setManagedVideos(prev => prev.filter(v => v.id !== videoId));
    
    // If deleting active video, clear it
    if (videoId === activeVideoId) {
      setActiveVideoId(null);
      setVideoId("");
      setVideoUrl("");
      setAnnotations([]);
      setInstances([]);
      setKeyframes([]);
      setScenes([]);
      setCurrentFrame(0);
    }

    toast({
      title: "Video removed",
      description: "Video removed from library",
    });
  };

  const processVideoFile = async (file: File) => {
    console.log("📤 processVideoFile: Starting upload for file:", file.name, "size:", file.size);

    // Create temporary managed video entry
    const tempId = `temp-${Date.now()}`;
    const tempVideo: ManagedVideo = {
      id: tempId,
      filename: file.name,
      status: 'syncing',
      frontendProgress: 0,
      isActive: false,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    setManagedVideos(prev => [...prev, tempVideo]);
    
    // Start upload to backend
    setIsUploading(true);
    toast({
      title: "Processing video",
      description: "Video will appear in your library when ready",
    });

    try {
      // === STEP 1: Check IndexedDB cache first (instant) ===
      console.log("💾 handleVideoUpload: Checking IndexedDB cache for:", file.name);
      
      try {
        await videoCache.init();
        const cached = await videoCache.get(file.name);
        
        if (cached) {
          console.log("💾 Cache HIT for:", file.name);
          console.log("💾 Verifying video still exists on backend with videoId:", cached.videoId);
          
          // Verify the cached video still exists on backend
          try {
            const videoInfo = await getVideoInfo(cached.videoId);
            console.log("💾 Backend verification SUCCESS - video exists");
            
            // Add to managed videos as ready
            const cachedManagedVideo: ManagedVideo = {
              id: cached.videoId,
              filename: file.name,
              status: 'ready',
              metadata: {
                duration: cached.metadata.duration,
                fps: cached.metadata.fps,
                width: cached.metadata.width,
                height: cached.metadata.height,
                totalFrames: cached.metadata.totalFrames,
              },
              isActive: false,
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
            };
            
            setManagedVideos(prev => prev.filter(v => v.id !== tempId).concat(cachedManagedVideo));
            setIsUploading(false);
            
            toast({
              title: "Video ready",
              description: `${file.name} loaded from cache`,
            });
            
            console.log("💾 Cache-based load complete - added to library");
            return; // EXIT EARLY - backend verified, cache is valid
            
          } catch (backendError) {
            console.warn("💾 Backend verification FAILED - video deleted from backend, invalidating cache");
            await videoCache.delete(file.name);
            console.log("💾 Cache entry deleted, will re-upload to backend");
            
            toast({
              title: "Cache invalidated",
              description: "Video was deleted from backend, re-uploading...",
            });
            // Continue to backend upload below
          }
        }
        
        console.log("💾 Cache MISS - proceeding to backend check");
      } catch (cacheError) {
        console.warn("💾 Cache check failed, falling back to backend:", cacheError);
        // Continue to backend check on cache failure
      }
      
      // === STEP 2: Check if video already exists on backend ===
      console.log("📤 handleVideoUpload: Checking for existing video:", file.name);
      let uploadResponse;
      
      try {
        const existsCheck = await checkVideoExists(file.name);
        console.log("📤 handleVideoUpload: Exists check response:", JSON.stringify(existsCheck));
        
        if (existsCheck.exists && existsCheck.video_id) {
          console.log("📤 handleVideoUpload: ✅ Video EXISTS - skipping upload, video_id:", existsCheck.video_id);
          
          // Get video info for the existing video
          const existingVideoInfo = await getVideoInfo(existsCheck.video_id);
          
          uploadResponse = {
            video_id: existsCheck.video_id,
            filename: existingVideoInfo.filename,
            duration: existingVideoInfo.duration,
            fps: existingVideoInfo.fps,
            resolution: `${existingVideoInfo.width}x${existingVideoInfo.height}`,
            total_frames: existingVideoInfo.total_frames,
            message: "Using existing video"
          };
        } else {
          console.log("📤 handleVideoUpload: ❌ Video does NOT exist - will upload");
        }
      } catch (checkError) {
        console.error("📤 handleVideoUpload: Error checking existing video:", checkError);
        console.log("📤 handleVideoUpload: Proceeding with upload due to error");
      }
      
      // Upload if not found
      if (!uploadResponse) {
        console.log("📤 handleVideoUpload: Starting backend upload");
        
        uploadResponse = await uploadVideo(file, (percent) => {
          // Update progress in managed video
          setManagedVideos(prev => prev.map(v => 
            v.id === tempId ? { ...v, frontendProgress: percent } : v
          ));
        });
      }
      
      console.log("📤 handleVideoUpload: Backend upload complete, video_id:", uploadResponse.video_id);
      
      // Fetch native video resolution from backend
      console.log("📤 handleVideoUpload: Fetching video info");
      const videoInfo = await getVideoInfo(uploadResponse.video_id);
      console.log("📤 handleVideoUpload: Video info received:", videoInfo.width, "x", videoInfo.height);
      
      // === STEP 3: Store in IndexedDB cache for future instant loads ===
      try {
        await videoCache.set(file.name, {
          videoId: uploadResponse.video_id,
          filename: file.name,
          blob: file,
          metadata: {
            duration: uploadResponse.duration || videoInfo.duration || 0,
            fps: uploadResponse.fps || videoInfo.fps || 0,
            width: videoInfo.width,
            height: videoInfo.height,
            totalFrames: uploadResponse.total_frames || videoInfo.total_frames || 0,
            cachedAt: Date.now(),
          }
        });
        console.log("💾 Video cached in IndexedDB for instant future loads");
      } catch (cacheError) {
        console.warn("💾 Failed to cache video in IndexedDB:", cacheError);
        // Don't block on cache failure
      }
      
      // Update managed video with final status
      const newManagedVideo: ManagedVideo = {
        id: uploadResponse.video_id,
        filename: file.name,
        status: 'ready',
        metadata: {
          duration: uploadResponse.duration || videoInfo.duration || 0,
          fps: uploadResponse.fps || videoInfo.fps || 0,
          width: videoInfo.width,
          height: videoInfo.height,
          totalFrames: uploadResponse.total_frames || videoInfo.total_frames || 0,
          fileSize: videoInfo.file_size,
        },
        isActive: false,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      
      setManagedVideos(prev => prev.filter(v => v.id !== tempId).concat(newManagedVideo));

      toast({
        title: "Video ready",
        description: `${file.name} is now available in your library`,
      });
      console.log("📤 handleVideoUpload: Video added to library");
    } catch (error) {
      console.error("📤 handleVideoUpload: Upload failed:", error);
      
      // Update temp video to error state
      setManagedVideos(prev => prev.map(v => 
        v.id === tempId ? { ...v, status: 'error' as const, error: error instanceof Error ? error.message : "Upload failed" } : v
      ));
      
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to process video",
        variant: "destructive",
      });
    } finally {
      console.log("📤 handleVideoUpload: Upload flow complete");
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDetectScenes = async () => {
    if (!videoId) {
      toast({
        title: "No video uploaded",
        description: "Please upload a video first",
        variant: "destructive",
      });
      return;
    }

    setIsDetectingScenes(true);
    toast({
      title: "Detecting scenes",
      description: "Running PySceneDetect...",
    });

    try {
      const sceneResponse = await detectScenes(videoId);
      
      // Convert API response to app Scene format
      const detectedScenes = sceneResponse.scenes.map(scene => ({
        id: `scene-${scene.scene_id}`,
        startFrame: scene.start_frame,
        endFrame: scene.end_frame,
        quality: scene.quality as "good" | "bad" | "unknown"
      }));
      
      setScenes(detectedScenes);
      toast({
        title: "Scenes detected",
        description: `Found ${sceneResponse.total_scenes} scenes`,
      });
    } catch (error) {
      console.error("Scene detection failed:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Scene detection failed",
        variant: "destructive",
      });
    } finally {
      setIsDetectingScenes(false);
    }
  };

  const handleSceneSelect = (scene: Scene | null) => {
    setSelectedScene(scene);
    if (scene) {
      setCurrentFrame(scene.startFrame);
      toast({
        title: "Scene selected",
        description: `Timeline zoomed to frames ${scene.startFrame}-${scene.endFrame}`,
      });
    } else {
      setCurrentFrame(0);
      toast({
        title: "Full video view",
        description: `Showing all frames`,
      });
    }
  };

  const handleSceneQualityChange = (sceneId: string, quality: "good" | "bad" | "unknown") => {
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, quality } : s))
    );
  };

  const handleGenerateMetadata = async () => {
    setIsGeneratingMetadata(true);
    toast({
      title: "Generating metadata",
      description: "AI is analyzing the entire video hierarchically...",
    });

    // Simulate AI processing delay (your local backend would do the actual processing)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock metadata generation - replace this with your local backend call
    // Your backend should return: { videoMetadata, sceneMetadata, keyframeMetadata }
    
    // 1. Video-level metadata
    const mockVideoMetadata: Record<string, string> = {
      "Wind Conditions": "15-20 knots, gusty",
      "Location": "Maui, Kanaha Beach",
      "Time of Day": "Morning session",
      "Water Conditions": "Choppy with 1-2m waves",
      "Overall Quality": "Good sailing conditions",
    };

    // 2. Scene-level metadata (for each scene)
    const mockSceneMetadata: Record<string, Record<string, string>> = {};
    scenes.forEach((scene, idx) => {
      if (scene.quality !== "bad") {
        mockSceneMetadata[scene.id] = {
          "Action": ["Cruising", "Jump attempt", "Speed run", "Freestyle", "Wave riding"][idx % 5],
          "Intensity": ["Low", "Medium", "High"][Math.floor(Math.random() * 3)],
          "Notable Events": `Key moment at frame ${scene.startFrame + Math.floor((scene.endFrame - scene.startFrame) / 2)}`,
        };
      }
    });

    // 3. Frame-level metadata (for META keyframes only)
    const mockKeyframeMetadata: Record<number, Record<string, string>> = {};
    keyframes.forEach(kf => {
      if (kf.type === "META") {
        mockKeyframeMetadata[kf.frame] = {
          "Trick": ["Forward Loop", "Backloop", "Vulcan", "Shaka", "Pushloop"][Math.floor(Math.random() * 5)],
          "Height": `${Math.floor(Math.random() * 5) + 1}m`,
          "Rotation": ["360°", "540°", "720°"][Math.floor(Math.random() * 3)],
          "Landing": ["Clean", "Partial", "Crashed"][Math.floor(Math.random() * 3)],
        };
      }
    });

    // Update all metadata states
    setVideoMetadata(mockVideoMetadata);
    
    setScenes(prev => prev.map(scene => ({
      ...scene,
      metadata: mockSceneMetadata[scene.id] || scene.metadata,
    })));

    setKeyframes(prev => prev.map(kf => ({
      ...kf,
      metadata: kf.type === "META" ? mockKeyframeMetadata[kf.frame] || kf.metadata : kf.metadata,
    })));

    setIsGeneratingMetadata(false);
    toast({
      title: "Metadata generated",
      description: `Generated metadata for video, ${Object.keys(mockSceneMetadata).length} scenes, and ${Object.keys(mockKeyframeMetadata).length} META keyframes`,
    });
  };

  const handleClearMetadata = (frame: number) => {
    setKeyframes(prev => prev.map(kf => 
      kf.frame === frame && kf.type === "META" ? { ...kf, metadata: undefined } : kf
    ));
    toast({
      title: "Metadata cleared",
      description: `Frame ${frame} metadata removed`,
    });
  };

  const handleAddMetadata = (frame: number) => {
    const keyframe = keyframes.find(kf => kf.frame === frame && kf.type === "META");
    const existingText = keyframe?.metadata?.description || "";
    setMetadataModal({ isOpen: true, frame, initialText: existingText });
  };

  const handleSaveMetadata = (text: string) => {
    if (metadataModal.frame !== undefined) {
      setKeyframes(prev => prev.map(kf => 
        kf.frame === metadataModal.frame && kf.type === "META" 
          ? { ...kf, metadata: { description: text } } 
          : kf
      ));
      toast({
        title: "Metadata saved",
        description: `Frame ${metadataModal.frame} metadata added`,
      });
    }
    setMetadataModal({ isOpen: false });
  };

  // Mock SAM2 segmentation - simulates backend call
  // Creates bbox 5-15% of canvas size with 3-6 point polygon inside
  const mockSAM2Segmentation = async (
    x: number, 
    y: number, 
    canvasWidth: number, 
    canvasHeight: number, 
    isNegative: boolean = false
  ): Promise<{
    points: Array<{ x: number; y: number }>;
    className: string;
  }> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Create bbox: 5-15% of canvas in PERCENTAGE UNITS (0-100 scale)
    // Note: x and y are already in percentage units from the click handler
    const bboxWidth = 5 + Math.random() * 10; // 5-15% width
    const bboxHeight = 5 + Math.random() * 10; // 5-15% height
    
    // Position bbox around click point (ensure it stays within 0-100 range)
    const bboxX = Math.max(0, Math.min(100 - bboxWidth, x - bboxWidth / 2));
    const bboxY = Math.max(0, Math.min(100 - bboxHeight, y - bboxHeight / 2));
    
    // Create 3-6 point polygon within the bbox
    const numPoints = 3 + Math.floor(Math.random() * 4); // 3-6 points
    const points = [];
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const radiusX = (bboxWidth / 2) * (0.7 + Math.random() * 0.3);
      const radiusY = (bboxHeight / 2) * (0.7 + Math.random() * 0.3);
      
      points.push({
        x: bboxX + bboxWidth / 2 + Math.cos(angle) * radiusX,
        y: bboxY + bboxHeight / 2 + Math.sin(angle) * radiusY,
      });
    }
    
    // Random class name from predefined options
    const classNames = ["Sail", "Board", "Windsurfer"];
    const className = classNames[Math.floor(Math.random() * classNames.length)];
    
    return { points, className };
  };

  const handleCanvasClick = useCallback(
    async (x: number, y: number, displayWidth: number, displayHeight: number, ctrlKey: boolean, altKey: boolean) => {
      // If in edit mode or select mode, don't handle canvas clicks
      if (selectedTool !== "annotate") return;

      console.log('🖱️ Canvas click:', { 
        percentageX: x.toFixed(2), 
        percentageY: y.toFixed(2),
        displayWidth,
        displayHeight,
        nativeWidth: videoNativeWidth,
        nativeHeight: videoNativeHeight
      });

      // Convert percentage (0-100) to native video pixel coordinates
      const videoX = Math.round((x / 100) * videoNativeWidth);
      const videoY = Math.round((y / 100) * videoNativeHeight);

      console.log('🎯 Mapped to native coords:', { videoX, videoY, videoNativeWidth, videoNativeHeight });

      // Determine prompt type: Alt (or Alt-Gr) = negative, Ctrl only = positive
      // Note: Alt-Gr registers as both ctrlKey and altKey on many keyboards
      const promptType: 'positive' | 'negative' = altKey ? 'negative' : 'positive';
      
      // Require at least one modifier key
      if (!ctrlKey && !altKey) {
        toast({
          title: "Hold modifier key",
          description: "Hold Ctrl for + prompt or Alt/Alt-Gr for - prompt while clicking",
        });
        return;
      }

      // Check if clicking on an existing annotation to add a prompt
      const clickedAnnotation = annotations.find(ann => {
        if (!ann.bbox || ann.frameCreated !== currentFrame) return false;
        const { x: bx, y: by, w: bw, h: bh } = ann.bbox;
        return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      });

      // If clicking on existing annotation, add SAM2 prompt to it
      if (clickedAnnotation) {
        
        setAnnotations(prev => prev.map(ann => {
          if (ann.id === clickedAnnotation.id) {
            const existingPrompts = ann.sam2Prompts || [];
            return { ...ann, sam2Prompts: [...existingPrompts, { x, y, type: promptType }] };
          }
          return ann;
        }));

        toast({
          title: `${promptType === 'positive' ? '+' : '-'} prompt added`,
          description: `Click added to existing annotation`,
        });
        return;
      }

      // If SAM2 is enabled and no existing annotation clicked, create new one
      if (useSAM2) {
        console.log('🎯 SAM2 enabled, checking videoId:', videoId);
        
        // Don't create new annotations with negative prompts
        if (altKey) {
          toast({
            title: "No annotation selected",
            description: "Negative prompts must be added to existing annotations",
            variant: "destructive",
          });
          return;
        }

        // Check if videoId exists
        if (!videoId) {
          toast({
            title: "No video loaded",
            description: "Please upload a video first",
            variant: "destructive",
          });
          console.error('❌ Cannot call SAM2: videoId is missing');
          return;
        }

        // Show loading toast
        toast({
          title: `Running SAM2 segmentation...`,
          description: "Detecting object boundary and class",
        });

        // Convert percentage (0-100) to native video pixel coordinates for backend
        const videoX = Math.round((x / 100) * videoNativeWidth);
        const videoY = Math.round((y / 100) * videoNativeHeight);

        console.log('🎯 Calling SAM2 API with:', { 
          videoId, 
          frame: currentFrame, 
          x: videoX, 
          y: videoY,
          nativeResolution: `${videoNativeWidth}×${videoNativeHeight}`
        });

        try {
          // Call real SAM2 backend API with native video pixel coordinates
          const sam2Response = await segmentWithSAM2({
            video_id: videoId,
            frame_number: currentFrame,
            click_prompts: [{ x: videoX, y: videoY, type: 'positive' }]
          });

          console.log('✅ SAM2 response received:', sam2Response);

          // Extract mask and bbox from response.results
          const results = (sam2Response as any).results;
          if (!results || !results.bbox) {
            throw new Error('Invalid SAM2 response: missing results or bbox');
          }
          
          // Parse bbox array [x1, y1, x2, y2] (corner coordinates in native video resolution)
          const [x1, y1, x2, y2] = results.bbox as [number, number, number, number];
          
          const maskBase64 = results.mask_base64 as string | undefined;
          
          // Backend returns coordinates in native video resolution
          // We normalize these to percentages for display
          const baseW = videoNativeWidth;
          const baseH = videoNativeHeight;

          // Calculate width and height from corner coordinates
          const bx = x1;
          const by = y1;
          const bw = x2 - x1;
          const bh = y2 - y1;

          const bbox = {
            x: (bx / baseW) * 100,
            y: (by / baseH) * 100,
            w: (bw / baseW) * 100,
            h: (bh / baseH) * 100,
          };
          
          // Keep mask for later
          const maskPixels = results.mask_pixels;
          
          // For now, generate polygon points from bbox (could extract contours from mask in future)
          // TODO: Convert mask_base64 PNG to polygon contour points for better visualization
          const points = [
            { x: bbox.x, y: bbox.y },
            { x: bbox.x + bbox.w, y: bbox.y },
            { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
            { x: bbox.x, y: bbox.y + bbox.h }
          ];
          
          console.log('📊 Extracted segmentation:', { 
            bbox, 
            points: points.length, 
            maskPixels,
            score: results.score,
            clickPercentage: { x: x.toFixed(2), y: y.toFixed(2) },
            clickNative: { x: videoX, y: videoY },
            nativeResolution: `${videoNativeWidth}×${videoNativeHeight}`
          });
          
          // Use DINO detection or default to "Sail" class
          const className = "Sail"; // TODO: Could call DINO here if needed

          // Find or create class
          let classData = classes.find(c => c.name === className);
          if (!classData) {
            const color = SAIL_COLORS[colorIndex % SAIL_COLORS.length];
            classData = {
              id: `class-${Date.now()}`,
              name: className,
              color: color.hex,
              colorName: color.name,
            };
            setClasses(prev => [...prev, classData!]);
            setColorIndex(prev => prev + 1);
          }

          // Create new instance for this class
          const classInstances = instances.filter(inst => inst.classId === classData.id);
          const instanceNumber = classInstances.length + 1;
          const newInstance: Instance = {
            id: `inst-${Date.now()}`,
            classId: classData.id,
            instanceNumber,
            metadata: {},
          };

          // Create annotation for this instance with initial positive prompt
          const newAnnotation: Annotation = {
            id: `ann-${Date.now()}`,
            instanceId: newInstance.id,
            points,
            bbox,
            maskBase64: maskBase64,
            maskBBox: bbox,
            frameCreated: currentFrame,
            sam2Prompts: [{ x, y, type: 'positive' }], // Add initial click as positive prompt
            isKeyframe: true, // Manual annotation
          };

          setInstances((prev) => [...prev, newInstance]);
          setAnnotations((prev) => [...prev, newAnnotation]);

          toast({
            title: "Segmentation complete",
            description: `${className}#${instanceNumber} detected and created`,
          });

          // Auto-create START keyframe if auto-track is enabled
          if (autoTrack) {
            const existingStart = keyframes.find(k => k.frame === currentFrame && k.type === "START");
            if (!existingStart) {
              handleAddKeyframe("START");
            }
          }
        } catch (error) {
          console.error('❌ SAM2 error:', error);
          toast({
            title: "Segmentation failed",
            description: error instanceof Error ? error.message : "Could not segment object",
            variant: "destructive",
          });
        }
        return;
      }

      // Original flow: require class selection when SAM2 is off
      if (!selectedClassId) {
        toast({
          title: "No class selected",
          description: "Create and select a class first",
        });
        return;
      }

      const selectedClass = classes.find(c => c.id === selectedClassId);
      if (!selectedClass) return;

      // Create mock annotation with SAM2 click-prompt
      const points = [];
      const radius = 5;
      for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        points.push({
          x: x + Math.cos(angle) * radius,
          y: y + Math.sin(angle) * radius,
        });
      }

      // Create new instance for this class
      const classInstances = instances.filter(inst => inst.classId === selectedClassId);
      const instanceNumber = classInstances.length + 1;
      const newInstance: Instance = {
        id: `inst-${Date.now()}`,
        classId: selectedClassId,
        instanceNumber,
        metadata: {},
      };

      // Create annotation for this instance
      const newAnnotation: Annotation = {
        id: `ann-${Date.now()}`,
        instanceId: newInstance.id,
        points,
        bbox: {
          x: x - radius,
          y: y - radius,
          w: radius * 2,
          h: radius * 2,
        },
        frameCreated: currentFrame,
        isKeyframe: true, // Manual annotation
      };

      setInstances((prev) => [...prev, newInstance]);
      setAnnotations((prev) => [...prev, newAnnotation]);

      // Auto-create START keyframe if auto-track is enabled
      if (autoTrack) {
        const existingStart = keyframes.find(k => k.frame === currentFrame && k.type === "START");
        if (!existingStart) {
          handleAddKeyframe("START");
          toast({
            title: "Instance created with START keyframe",
            description: `${selectedClass.name}#${instanceNumber} at frame ${currentFrame}`,
          });
        } else {
          toast({
            title: "Instance created",
            description: `${selectedClass.name}#${instanceNumber} at frame ${currentFrame}`,
          });
        }
      } else {
        toast({
          title: "Instance created",
          description: `${selectedClass.name}#${instanceNumber} at frame ${currentFrame}`,
        });
      }
    },
    [currentFrame, selectedClassId, classes, instances, toast, autoTrack, keyframes, useSAM2, colorIndex, videoId, videoNativeWidth, videoNativeHeight]
  );

  const handleContextMenu = (x: number, y: number, context: any) => {
    setContextMenu({ x, y, context });
  };

  const handleStartTracking = (annotationId: string) => {
    const annotation = annotations.find(a => a.id === annotationId);
    if (!annotation) return;

    const startFrame = annotation.frameCreated;
    const stopKeyframe = keyframes.find(
      k => k.type === "STOP" && k.frame > startFrame
    );

    if (!stopKeyframe) {
      toast({
        title: "No STOP keyframe found",
        description: "Add a STOP keyframe after this annotation",
      });
      return;
    }

    const newJob: TrackingJob = {
      id: `job-${Date.now()}`,
      startFrame,
      stopFrame: stopKeyframe.frame,
      objectIds: [annotationId],
      status: "pending",
    };

    setTrackingJobs([...trackingJobs, newJob]);
    toast({
      title: "Tracking job created",
      description: `Frames ${startFrame} → ${stopKeyframe.frame}`,
    });
  };

  const handleProcessJob = async (jobId: string) => {
    const job = trackingJobs.find(j => j.id === jobId);
    if (!job || !videoId) return;

    // Extract click_prompts from annotations in this segment
    const segmentAnnotations = annotations.filter(ann => 
      job.objectIds.includes(ann.id) && ann.sam2Prompts && ann.sam2Prompts.length > 0
    );

    if (segmentAnnotations.length === 0) {
      toast({
        title: "No prompts found",
        description: "Annotations in this segment need SAM2 click prompts",
        variant: "destructive",
      });
      return;
    }

    // Collect ALL click prompts from all annotations
    const allClickPrompts = segmentAnnotations.flatMap(ann => 
      ann.sam2Prompts!.map(p => ({
        x: Math.round((p.x / 100) * videoNativeWidth),
        y: Math.round((p.y / 100) * videoNativeHeight),
        type: p.type
      }))
    );

    console.log('🎯 Tracking job click prompts:', {
      promptCount: allClickPrompts.length,
      prompts: allClickPrompts,
      nativeResolution: `${videoNativeWidth}×${videoNativeHeight}`
    });

    try {
      // Create tracking job with backend (auto-splits if needed)
      toast({
        title: "Creating tracking job",
        description: "Analyzing segment size and memory requirements...",
      });

      const createResponse = await createTrackingJob(videoId, [{
        start_frame: job.startFrame,
        end_frame: job.stopFrame,
        click_prompts: allClickPrompts
      }]);

      console.log('📦 Tracking job creation response:', createResponse);

      // Handle both response formats: single_job or auto_split_result
      let subJobs: SubJob[];
      let isSplit = false;
      let estimatedMemory = '';

      if (createResponse.auto_split_result) {
        // Multi-part job (split required)
        const { auto_split_result } = createResponse;
        isSplit = auto_split_result.split_required;
        estimatedMemory = auto_split_result.estimated_memory || '';
        subJobs = auto_split_result.created_jobs;
        
        toast({
          title: "Job auto-split",
          description: `Split into ${subJobs.length} parts (~${estimatedMemory})`,
        });
      } else if (createResponse.single_job) {
        // Single job (no split needed)
        const { single_job } = createResponse;
        isSplit = false;
        estimatedMemory = single_job.estimated_memory || '';
        subJobs = [{
          job_id: single_job.job_id,
          name: single_job.name || 'Tracking Job',
          start_frame: single_job.start_frame,
          end_frame: single_job.end_frame,
          frames: single_job.frames,
          prompt_source: 'manual'
        }];
      } else {
        console.error('❌ Invalid tracking response structure:', createResponse);
        throw new Error(`Invalid response format. Expected 'auto_split_result' or 'single_job'`);
      }
      
      console.log(`✅ Job created with ${subJobs.length} sub-job(s)`);
      
      // Update job with auto-split info
      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? {
            ...j,
            status: "processing" as const,
            progress: 0,
            isSplit,
            estimatedMemory,
            subJobs: subJobs.map(subJob => ({
              ...subJob,
              status: "pending" as const
            }))
          } : j
        )
      );

      // Execute each sub-job sequentially
      for (let i = 0; i < subJobs.length; i++) {
        const subJob = subJobs[i];
        
        // Mark sub-job as processing
        setTrackingJobs(jobs =>
          jobs.map(j =>
            j.id === jobId && j.subJobs ? {
              ...j,
              subJobs: j.subJobs.map((sj, idx) =>
                idx === i ? { ...sj, status: "processing" as const, progress: 0 } : sj
              )
            } : j
          )
        );

        // Execute tracking
        console.log(`🚀 Starting tracking job: ${subJob.job_id}`);
        await executeTrackingJob(subJob.job_id);

        // Poll for completion with timeout
        let completed = false;
        let pollCount = 0;
        const maxPolls = 300; // 5 minutes max (300 seconds)
        
        while (!completed && pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every second
          pollCount++;
          
          const status = await getTrackingJobStatus(subJob.job_id);
          
          console.log(`📊 Poll #${pollCount} for job ${subJob.name}:`, status.status, `${status.percentage}%`);
          
          // Update progress
          setTrackingJobs(jobs =>
            jobs.map(j =>
              j.id === jobId && j.subJobs ? {
                ...j,
                progress: Math.round(((i + (status.percentage || 0) / 100) / subJobs.length) * 100),
                subJobs: j.subJobs.map((sj, idx) =>
                  idx === i ? { ...sj, progress: status.percentage } : sj
                )
              } : j
            )
          );

          if (status.status === "completed") {
            console.log(`✅ Job ${subJob.name} completed!`);
            completed = true;
            
            // Mark sub-job as completed
            setTrackingJobs(jobs =>
              jobs.map(j =>
                j.id === jobId && j.subJobs ? {
                  ...j,
                  subJobs: j.subJobs.map((sj, idx) =>
                    idx === i ? { ...sj, status: "completed" as const, progress: 100 } : sj
                  )
                } : j
              )
            );
          } else if (status.status === "failed") {
            console.error(`❌ Job ${subJob.name} failed`);
            throw new Error(`Sub-job ${subJob.name} failed: ${status.error}`);
          }
        }
        
        if (!completed) {
          console.error(`⏱️ Polling timeout after ${pollCount} attempts for job ${subJob.name}`);
          throw new Error(`Tracking job timed out after ${pollCount} seconds. Backend may still be processing.`);
        }
      }

      // All sub-jobs completed - fetch and create annotations from tracking results
      const allResults: any[] = [];
      
      console.log(`📦 Fetching results from ${subJobs.length} sub-job(s)...`);
      
      for (let subJobIndex = 0; subJobIndex < subJobs.length; subJobIndex++) {
        const subJob = subJobs[subJobIndex];
        try {
          const results = await getTrackingJobResults(subJob.job_id);

          // Normalize backend results to a consistent per-frame array
          const frames = Array.isArray(results.results)
            ? results.results
            : Array.isArray((results as any).results?.frames)
              ? (results as any).results.frames
              : [];

          // Map multi-object backend results to flat array of per-object-per-frame results
          const normalized: Array<{ 
            frame_number: number; 
            object_id: number;
            bbox: [number, number, number, number]; 
            mask_base64?: string; 
            score?: number 
          }> = [];

          for (const r of frames) {
            const frame_number = r.frame_number ?? r.frame;
            if (typeof frame_number !== 'number') continue;

            // Handle multi-object format: object_ids, bboxes, masks_base64 arrays
            if (Array.isArray(r.object_ids) && Array.isArray(r.bboxes)) {
              for (let i = 0; i < r.object_ids.length; i++) {
                const bbox = r.bboxes[i];
                if (!bbox) continue;
                
                normalized.push({
                  frame_number,
                  object_id: r.object_ids[i],
                  bbox,
                  mask_base64: r.masks_base64?.[i],
                  score: r.scores?.[i]
                });
              }
            } 
            // Fallback: single-object format
            else {
              const bbox = r.bbox ?? (Array.isArray(r.bboxes) ? r.bboxes[0] : undefined);
              const mask_base64 = r.mask_base64 ?? r.maskBase64 ?? r.mask?.base64;
              const score = r.score ?? r.confidence;
              
              if (bbox) {
                normalized.push({
                  frame_number,
                  object_id: 1, // Default to object_id 1 for backward compatibility
                  bbox,
                  mask_base64,
                  score
                });
              }
            }
          }

          if (normalized.length > 0) {
            console.log(`✅ Fetched ${normalized.length} results from ${subJob.name}:`, {
              firstFrame: normalized[0]?.frame_number,
              lastFrame: normalized[normalized.length - 1]?.frame_number,
              sampleBbox: normalized[0]?.bbox,
              hasMasks: normalized.some(r => !!r.mask_base64)
            });
            allResults.push(...normalized);
          } else {
            console.warn(`⚠️ ${subJob.name} returned no usable per-frame tracking data:`, results);
            toast({
              title: "No Tracking Frames Parsed",
              description: `Received results but could not parse frames. Check backend result schema (expect frames[].bbox or bboxes[0]).`,
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error(`Failed to fetch results for ${subJob.name}:`, error);
        }
      }

      console.log(`📊 Total tracking results retrieved: ${allResults.length}`);
      console.log('Sample of first 3 results:', allResults.slice(0, 3).map(r => ({
        frame: r.frame_number,
        bbox: r.bbox,
        hasMask: !!r.mask_base64
      })));

      // Create new annotations for each tracked frame and object
      if (allResults.length > 0) {
        const newAnnotations: Annotation[] = [];
        
        // Group results by object_id to map back to original annotations
        console.log(`🎨 Creating annotations for ${segmentAnnotations.length} objects...`);
        
        // Always skip the starting frame result to avoid duplicating the manual keyframe
        const filteredResults = allResults.filter(r => r.frame_number !== job.startFrame);
        
        for (const result of filteredResults) {
          
          // Map object_id back to original annotation (object_id is 1-based)
          const originalAnnotation = segmentAnnotations[result.object_id - 1];
          if (!originalAnnotation) {
            console.warn(`⚠️ No annotation found for object_id ${result.object_id}`);
            continue;
          }
          // Decode mask to get dimensions
          let maskWidth: number | undefined;
          let maskHeight: number | undefined;
          if (result.mask_base64) {
            try {
              const img = new Image();
              img.src = `data:image/png;base64,${result.mask_base64}`;
              await img.decode();
              maskWidth = img.width;
              maskHeight = img.height;
            } catch (e) {
              console.warn('Failed to decode mask for frame', result.frame_number);
            }
          }

          // Convert bbox from [x1, y1, x2, y2] to percentage-based format
          // ⚠️ CRITICAL: Backend bbox is ALWAYS in native video coordinates, NOT mask coordinates
          const [x1, y1, x2, y2] = result.bbox;
          const bboxWidth = x2 - x1;
          const bboxHeight = y2 - y1;
          
          // Always use video native dimensions for bbox conversion (backend returns video coords)
          const baseW = videoNativeWidth || 1280;
          const baseH = videoNativeHeight || 720;
          
          const bbox = {
            x: (x1 / baseW) * 100,
            y: (y1 / baseH) * 100,
            w: (bboxWidth / baseW) * 100,
            h: (bboxHeight / baseH) * 100,
          };

          // Create polygon points from bbox
          const points = [
            { x: bbox.x, y: bbox.y },
            { x: bbox.x + bbox.w, y: bbox.y },
            { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
            { x: bbox.x, y: bbox.y + bbox.h }
          ];

          // Determine if mask is a cropped tile or full-frame
          const isCropped = maskWidth && maskHeight && videoNativeWidth && videoNativeHeight
            ? !(maskWidth === videoNativeWidth && maskHeight === videoNativeHeight)
            : false;

          newAnnotations.push({
            id: `ann-tracked-${result.object_id}-${result.frame_number}-${Date.now()}-${Math.random()}`,
            instanceId: originalAnnotation.instanceId,
            points,
            bbox,
            maskBase64: result.mask_base64,
            maskBBox: bbox,
            maskWidth,
            maskHeight,
            maskIsCropped: isCropped,
            frameCreated: result.frame_number,
            isKeyframe: false // Tracked, not manual
          });
        }
        
        console.log(`✅ Created ${newAnnotations.length} annotations across ${segmentAnnotations.length} objects. Sample:`, 
          newAnnotations.slice(0, 3).map(a => ({ frame: a.frameCreated, bbox: a.bbox, instanceId: a.instanceId }))
        );

        // Add all new tracked annotations
        setAnnotations(prevAnnotations => [...prevAnnotations, ...newAnnotations]);
        console.log(`✅ Added ${newAnnotations.length} tracked annotations to state`);
      }

      const fakeTrackedRanges: [number, number][] = [
        [job.startFrame, job.stopFrame]
      ];

      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? { ...j, status: "completed" as const, progress: 100 } : j
        )
      );

      // (Removed) Avoid marking original keyframe as tracked across range to prevent duplicate overlays
      // We rely on per-frame tracked annotations created above.

      toast({
        title: "Tracking completed",
        description: `Created ${allResults.length} annotations across ${subJobs.length} segment(s)`,
      });

    } catch (error) {
      console.error("Tracking failed:", error);
      
      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? { ...j, status: "failed" as const } : j
        )
      );

      toast({
        title: "Tracking failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDeleteJob = (jobId: string) => {
    setTrackingJobs(jobs => jobs.filter(job => job.id !== jobId));
    toast({
      title: "Job deleted",
    });
  };

  const handleToggleOverlay = (key: "segments" | "bboxes" | "points") => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAutoDetect = async () => {
    try {
      toast({
        title: "Detecting objects...",
        description: "Running SAM2 detection",
      });

      const { detections } = await detectObjects(1920, 1080);

      // Create classes for each detected object
      const newClasses: Class[] = [];
      const newInstances: Instance[] = [];
      const newAnnotations: Annotation[] = [];

      detections.forEach((detection: any, idx: number) => {
        // Check if class already exists
        let cls = classes.find(c => c.name === detection.className);
        
        if (!cls) {
          cls = {
            id: `class-${Date.now()}-${idx}`,
            name: detection.className,
            color: detection.color,
            colorName: detection.colorName,
          };
          newClasses.push(cls);
        }

        // Create instance
        const instance: Instance = {
          id: `instance-${Date.now()}-${idx}`,
          classId: cls.id,
          instanceNumber: instances.filter(i => i.classId === cls!.id).length + 1,
          metadata: {},
        };
        newInstances.push(instance);

        // Create annotation
        const annotation: Annotation = {
          id: `annotation-${Date.now()}-${idx}`,
          instanceId: instance.id,
          frameCreated: currentFrame,
          points: detection.points,
          bbox: detection.bbox,
          isKeyframe: true, // Auto-detected annotation
        };
        newAnnotations.push(annotation);
      });

      setClasses(prev => [...prev, ...newClasses]);
      setInstances(prev => [...prev, ...newInstances]);
      setAnnotations(prev => [...prev, ...newAnnotations]);

      toast({
        title: "Detection complete",
        description: `Found ${detections.length} objects`,
      });
    } catch (error) {
      console.error('Auto-detect error:', error);
      toast({
        title: "Detection failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    }
  };

  const handleCreateClass = (name: string) => {
    const color = SAIL_COLORS[colorIndex % SAIL_COLORS.length];
    const newClass: Class = {
      id: `class-${Date.now()}`,
      name,
      color: color.hex,
      colorName: color.name,
    };
    setClasses((prev) => [...prev, newClass]);
    setColorIndex((prev) => prev + 1);
    setSelectedClassId(newClass.id);
    toast({
      title: "Class created",
      description: name,
    });
  };

  const handleRenameClass = (classId: string, newName: string) => {
    setClasses((prev) =>
      prev.map((c) => (c.id === classId ? { ...c, name: newName } : c))
    );
  };

  const handleDeleteClass = (classId: string) => {
    const classInstances = instances.filter(inst => inst.classId === classId);
    const instanceIds = classInstances.map(inst => inst.id);
    
    setClasses((prev) => prev.filter((c) => c.id !== classId));
    setInstances((prev) => prev.filter((inst) => inst.classId !== classId));
    setAnnotations((prev) => prev.filter((ann) => !instanceIds.includes(ann.instanceId)));
    
    if (selectedClassId === classId) {
      setSelectedClassId(undefined);
    }
    
    toast({
      title: "Class deleted",
      description: "All instances and annotations removed",
    });
  };

  const handleRenameInstance = (instanceId: string, newName: string) => {
    setInstances((prev) =>
      prev.map((inst) => (inst.id === instanceId ? { ...inst, name: newName } : inst))
    );
  };

  const handleDeleteInstance = (instanceId: string) => {
    setInstances((prev) => prev.filter((inst) => inst.id !== instanceId));
    setAnnotations((prev) => prev.filter((ann) => ann.instanceId !== instanceId));
    toast({
      title: "Instance deleted",
    });
  };

  const handleUpdateMetadata = (instanceId: string, metadata: Record<string, string>) => {
    setInstances((prev) =>
      prev.map((inst) => (inst.id === instanceId ? { ...inst, metadata } : inst))
    );
  };

  const handleAddKeyframe = (type: "START" | "STOP" | "SKIP" | "META") => {
    // Check if keyframe of this type already exists at current frame
    const existingKeyframe = keyframes.find(k => k.frame === currentFrame && k.type === type);
    
    if (existingKeyframe) {
      // Toggle off: remove the keyframe
      setKeyframes((prev) => prev.filter((k) => !(k.frame === currentFrame && k.type === type)));
      toast({
        title: `${type} keyframe removed`,
        description: `Frame ${currentFrame}`,
      });
    } else {
      // Toggle on: add the keyframe
      const newKeyframe: Keyframe = {
        frame: currentFrame,
        type,
        timestamp: new Date().toISOString(),
      };
      setKeyframes((prev) => [...prev, newKeyframe]);
      toast({
        title: `${type} keyframe added`,
        description: `Frame ${currentFrame}`,
      });
    }
  };

  const handleDeleteKeyframe = (frame: number) => {
    setKeyframes((prev) => prev.filter((k) => k.frame !== frame));
  };

  const handleDeletePrompt = (annotationId: string, promptIndex: number) => {
    setAnnotations(prev => prev.map(ann => {
      if (ann.id === annotationId && ann.sam2Prompts) {
        const updatedPrompts = ann.sam2Prompts.filter((_, i) => i !== promptIndex);
        return { ...ann, sam2Prompts: updatedPrompts.length > 0 ? updatedPrompts : undefined };
      }
      return ann;
    }));
    toast({
      title: "Prompt deleted",
      description: "SAM2 point removed from annotation",
    });
  };

  const handleSaveProject = () => {
    const project = {
      version: "0.3.0-hierarchical",
      videoUrl,
      currentFrame,
      totalFrames,
      classes,
      instances,
      annotations,
      keyframes,
      savedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotation-project-${Date.now()}.json`;
    a.click();

    toast({
      title: "Project saved",
      description: "JSON file downloaded",
    });
  };

  const handleExportData = () => {
    const exportData = {
      classes,
      instances,
      annotations,
      keyframes,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotations-export-${Date.now()}.json`;
    a.click();

    toast({
      title: "Data exported",
      description: "Hierarchical annotations exported to JSON",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[hsl(var(--sail-blue))] to-[hsl(var(--sail-purple))] bg-clip-text text-transparent">
                Video Annotation Tool
              </h1>
              <p className="text-sm text-muted-foreground">v0.3.0 - Hierarchical class-based tracking</p>
            </div>
            <div className="flex items-center gap-2">
              <BackendSelector backendStatus={backendStatus} />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setVideoManagerOpen(true)}
              >
                <Video className="h-4 w-4 mr-2" />
                My Videos {managedVideos.length > 0 && `(${managedVideos.length})`}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSaveProject}>
                <Save className="h-4 w-4 mr-2" />
                Save Project
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportData}>
                <Download className="h-4 w-4 mr-2" />
                Export...
              </Button>
              {videoUrl && (
                <Button variant="outline" size="sm" onClick={() => setMaximizeVideo((v) => !v)}>
                  {maximizeVideo ? "Exit Full Width" : "Full Width Video"}
                </Button>
              )}
              <Button variant="outline" size="sm">
                <Keyboard className="h-4 w-4 mr-2" />
                Shortcuts
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                disabled={isUploading}
                onClick={() => setVideoManagerOpen(true)}
              >
                <Upload className="h-4 w-4 mr-2" />
                {isUploading ? "Processing..." : videoUrl ? "Add Video" : "Load Video"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={`w-full ${maximizeVideo ? "px-0 py-2" : "px-4 py-6"}`}>
        {!videoUrl && !videoId ? (
          <div className="flex items-center justify-center min-h-[600px]">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold">Load a video to begin</h2>
              <p className="text-muted-foreground max-w-md">
                Upload a video file or provide a YouTube link to start annotating with multi-AI analysis support
              </p>
              <Button 
                variant="default" 
                onClick={() => setVideoManagerOpen(true)}
              >
                <Upload className="h-4 w-4 mr-2" />
                Add Video
              </Button>
            </div>
          </div>
        ) : (
          <div className={`grid grid-cols-12 ${maximizeVideo ? "gap-0" : "gap-3"}` }>
            {/* Left sidebar - Controls */}
            <div className={maximizeVideo ? "hidden" : "col-span-2 space-y-4"}>
              <Toolbox
                selectedTool={selectedTool}
                onToolChange={setSelectedTool}
                autoTrack={autoTrack}
                onAutoTrackChange={setAutoTrack}
                autoDetect={autoDetect}
                onAutoDetectChange={setAutoDetect}
                useSAM2={useSAM2}
                onUseSAM2Change={setUseSAM2}
              />
              <ClassManager
                classes={classes}
                instances={instances}
                annotations={annotations}
                currentFrame={currentFrame}
                overlays={overlays}
                selectedClassId={selectedClassId}
                showLabels={showLabels}
                onToggleOverlay={handleToggleOverlay}
                onShowLabelsChange={setShowLabels}
                onSelectClass={setSelectedClassId}
                onCreateClass={handleCreateClass}
                onRenameClass={handleRenameClass}
                onDeleteClass={handleDeleteClass}
                onRenameInstance={handleRenameInstance}
                onDeleteInstance={handleDeleteInstance}
                onUpdateMetadata={handleUpdateMetadata}
              />
            </div>

            {/* Center - Video player & Timeline */}
            <div className={maximizeVideo ? "col-span-12 space-y-4" : "col-span-8 space-y-4"}>
              <VideoPlayer
                videoUrl={videoUrl}
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                frameRange={frameRange}
                onFrameChange={setCurrentFrame}
                onVideoMetadata={(metadata) => {
                  // Only set total frames if not already set from upload
                  if (!videoId) {
                    setTotalFrames(metadata.totalFrames);
                  }
                }}
                onCanvasClick={handleCanvasClick}
                classes={classes}
                instances={instances}
                annotations={annotations}
                onAnnotationUpdate={(id, updates) => {
                  setAnnotations(prev => 
                    prev.map(ann => ann.id === id ? { ...ann, ...updates } : ann)
                  );
                }}
                onAnnotationSelect={setSelectedAnnotationId}
                overlays={overlays}
                selectedTool={selectedTool}
                selectedAnnotationId={selectedAnnotationId}
                onContextMenu={handleContextMenu}
                showLabels={showLabels}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
              />
              <HierarchicalTimeline
                classes={classes}
                instances={instances}
                annotations={annotations}
                keyframes={keyframes}
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                frameRange={frameRange}
                onFrameChange={setCurrentFrame}
                selectedScene={selectedScene}
                trackingJobs={trackingJobs}
                scenes={scenes}
                onClearScene={() => {
                  setSelectedScene(null);
                  toast({
                    title: "Timeline reset",
                    description: "Showing full video range",
                  });
                }}
                onDeleteKeyframe={handleDeleteKeyframe}
                onAddMetadata={handleAddMetadata}
                onClearMetadata={handleClearMetadata}
              />
            </div>

            {/* Right sidebar - Scenes & Tracking tabs */}
            <div className={maximizeVideo ? "hidden" : "col-span-2 min-w-[220px]"}>
              <Tabs defaultValue="scenes" className="h-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="scenes">Scenes</TabsTrigger>
                  <TabsTrigger value="tracking">Tracking</TabsTrigger>
                  <TabsTrigger value="cache">Cache</TabsTrigger>
                </TabsList>
                <TabsContent value="scenes" className="mt-4">
                  <ScenesManager
                    scenes={scenes}
                    currentFrame={currentFrame}
                    totalFrames={totalFrames}
                    selectedScene={selectedScene}
                    onDetectScenes={handleDetectScenes}
                    onSceneSelect={handleSceneSelect}
                    onSceneQualityChange={handleSceneQualityChange}
                    onGenerateMetadata={handleGenerateMetadata}
                    isDetecting={isDetectingScenes}
                    isGenerating={isGeneratingMetadata}
                  />
                </TabsContent>
                <TabsContent value="tracking" className="mt-4 space-y-4">
                  <KeyframeManager
                    keyframes={keyframes}
                    currentFrame={currentFrame}
                    onAddKeyframe={handleAddKeyframe}
                    onDeleteKeyframe={handleDeleteKeyframe}
                  />
                  <TrackingJobs
                    jobs={trackingJobs}
                    onProcessJob={handleProcessJob}
                    onDeleteJob={handleDeleteJob}
                  />
                </TabsContent>
                <TabsContent value="cache" className="mt-4">
                  <VideoCacheManager currentVideoId={videoId} />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </main>

      {/* Download Queue - Fixed position */}
      {downloadQueue.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-96">
          <DownloadQueue 
            downloads={downloadQueue}
            onCancel={handleCancelDownload}
            onRemove={handleRemoveDownload}
          />
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          context={contextMenu.context}
          onClose={() => setContextMenu(null)}
          onDeleteAnnotation={handleDeleteInstance}
          onDeleteKeyframe={handleDeleteKeyframe}
          onAddKeyframe={handleAddKeyframe}
          onStartTracking={handleStartTracking}
          onDeletePrompt={handleDeletePrompt}
          onClearMetadata={handleClearMetadata}
          onAddMetadata={handleAddMetadata}
          keyframes={keyframes}
        />
      )}
      <MetadataModal
        isOpen={metadataModal.isOpen}
        onClose={() => setMetadataModal({ isOpen: false })}
        onSave={handleSaveMetadata}
        initialText={metadataModal.initialText || ""}
        frame={metadataModal.frame}
      />
      <VideoManager
        open={videoManagerOpen}
        onOpenChange={setVideoManagerOpen}
        videos={managedVideos}
        activeVideoId={activeVideoId}
        onVideoSelect={handleVideoSelect}
        onVideoDelete={handleVideoDelete}
        onFileSelect={processVideoFile}
        onYoutubeUrl={handleYoutubeUrl}
        isUploading={isUploading}
      />
    </div>
  );
};

export default Index;
