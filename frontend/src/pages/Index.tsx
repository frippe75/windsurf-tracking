import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { VideoPlayer } from "@/components/VideoPlayer";
import { SamModelPanel } from "@/components/SamModelPanel";
import { ClassManager } from "@/components/ClassManager";
import { KeyframeManager } from "@/components/KeyframeManager";
import { HierarchicalTimeline } from "@/components/HierarchicalTimeline";
import { ScenesManager } from "@/components/ScenesManager";
import { Toolbox, type ToolMode } from "@/components/Toolbox";
import { ContextMenu } from "@/components/ContextMenu";
import { TrackingJobs } from "@/components/TrackingJobs";

import { MetadataEditor } from "@/components/MetadataEditor";
import { MetadataModal } from "@/components/MetadataModal";
import { DownloadQueue, type DownloadJob } from "@/components/DownloadQueue";
import { ProjectManager } from "@/components/ProjectManager";
import { ProjectManager_v2 } from "@/components/ProjectManager_v2";
import { AddResourcesDialog } from "@/components/AddResourcesDialog";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, Keyboard, Save, Download, Video, FolderOpen } from "lucide-react";
import labelBeeLogoNoByline from "@/assets/labelbee-logo-no-byline.png";
import labelBeeDarkSailLogo from "@/assets/labelbee-dark-sail.png";
import { Class, Instance, Annotation, Keyframe, Scene } from "@/types/annotation";
import { ManagedVideo } from "@/types/video";
import { Project, createEmptyProject } from "@/types/project";
import { detectObjects, uploadVideo, detectScenes, checkBackendHealth, segmentWithSAM2, getVideoInfo, checkVideoExists, downloadFromYouTube, getYouTubeDownloadStatus, downloadVideoFile, getVideoStreamUrl, createProject, createBackendProject, createBackendClass, saveBackendAnnotations, exportDataset } from "@/lib/api";
import { exportProjectAsYolo } from "@/lib/datasetExport";
import { pctToNative, nativeBBoxToPct, bboxToPolygon } from "@/lib/coordinates";
import { useProjects } from "@/hooks/useProjects";
import { useVideoLibrary } from "@/hooks/useVideoLibrary";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useTrackingJobs } from "@/hooks/useTrackingJobs";
import { SAIL_COLORS, annotationsAtFrame } from "@/lib/annotationOps";
import { resolveVideoSource as resolveVideoSourceCore, type VideoMetadata as VideoSourceMetadata } from "@/lib/videoSource";
import { extractYoutubeId, youtubeThumbnail } from "@/lib/youtubeUrl";
import { resolvePromptType, type PromptType } from "@/lib/promptType";
import { videoCache } from "@/lib/videoCache";
import { BackendSelector, type Backend, getProbeBackends, updateBackendProbeStatus } from "@/components/BackendSelector";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/hooks/useAuth";
import { getToolPreferences, saveToolPreferences, getBackendSettings } from "@/lib/settings";
import { config } from "@/lib/config";

const Index = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isAuthRequired, isAuthenticated, logout } = useAuth();
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [videoId, setVideoId] = useState<string>("");
  const [videoNativeWidth, setVideoNativeWidth] = useState<number>(1280);
  const [videoNativeHeight, setVideoNativeHeight] = useState<number>(720);
  const [blobUrlsRef] = useState<{ current: Set<string> }>({ current: new Set() });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [backendStatus, setBackendStatus] = useState<"checking" | "healthy" | "offline">("checking");
  const [backends, setBackends] = useState<Backend[]>([]);
  const backendsRef = useRef<Backend[]>([]);
  const isCheckingRef = useRef(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(3000);

  // Annotation workspace domain: classes/instances/annotations/keyframes/
  // scenes/videoMetadata + their handlers (pure ops in lib/annotationOps).
  const {
    classes,
    setClasses,
    instances,
    setInstances,
    annotations,
    setAnnotations,
    keyframes,
    setKeyframes,
    scenes,
    setScenes,
    videoMetadata,
    setVideoMetadata,
    selectedClassId,
    setSelectedClassId,
    colorIndex,
    setColorIndex,
    handleCreateClass,
    handleRenameClass,
    handleDeleteClass,
    handleRenameInstance,
    handleDeleteInstance,
    handleUpdateMetadata,
    handleAnnotationUpdate,
    handleAddKeyframe,
    handleDeleteKeyframe,
    handleDeletePrompt,
    handleSceneQualityChange,
  } = useAnnotations({ currentFrame, toast });

  // Tracking-jobs domain: auto-created segment jobs, execution/polling,
  // result ingestion into tracked annotations.
  const {
    trackingJobs,
    setTrackingJobs,
    handleStartTracking,
    handleProcessJob,
    handleDeleteJob,
  } = useTrackingJobs({
    videoId,
    videoNativeWidth,
    videoNativeHeight,
    annotations,
    keyframes,
    setAnnotations,
    toast,
  });

  const [isDetectingScenes, setIsDetectingScenes] = useState(false);

  // Load tool preferences from settings
  const toolPrefs = getToolPreferences();
  const [overlays, setOverlays] = useState(toolPrefs.overlays);
  const [selectedTool, setSelectedTool] = useState<ToolMode>("annotate");
  // Touch prompt mode: on phones there is no Ctrl/Alt, so a plain tap places
  // this prompt type. null = desktop behaviour (hold a modifier).
  const [promptTapMode, setPromptTapMode] = useState<PromptType | null>(null);
  const [autoTrack, setAutoTrack] = useState(toolPrefs.autoTrack);
  const [autoDetect, setAutoDetect] = useState(toolPrefs.autoDetect);
  const [useSAM2, setUseSAM2] = useState(toolPrefs.useSAM2);
  const [showLabels, setShowLabels] = useState(toolPrefs.showLabels);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    context: any;
  } | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [maximizeVideo, setMaximizeVideo] = useState(toolPrefs.maximizeVideo);
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [metadataModal, setMetadataModal] = useState<{
    isOpen: boolean;
    frame?: number;
    initialText?: string;
  }>({ isOpen: false });
  const [downloadQueue, setDownloadQueue] = useState<DownloadJob[]>([]);
  const [videoManagerOpen, setVideoManagerOpen] = useState(false);
  const [showProjectManager_v2, setShowProjectManager_v2] = useState(false);
  const [showAddResources, setShowAddResources] = useState(false);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [currentLogoIndex, setCurrentLogoIndex] = useState(0);
  const logos = [labelBeeLogoNoByline, labelBeeDarkSailLogo];
  const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";
  
  // Video library domain: localStorage persistence, backend merge on mount,
  // delete handler (guarded by project usage).
  const {
    managedVideos,
    setManagedVideos,
    addVideo,
    handleVideoDelete,
    deleteVideosFromCache,
  } = useVideoLibrary({
    toast,
    countProjectsUsingVideo: (id) => projects.filter(p => p.videoIds.includes(id)).length,
  });

  // Project domain: localStorage persistence, backend sync/hydration,
  // debounced auto-save, create/select/delete/rename handlers.
  const {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    currentVideoIdInProject,
    setCurrentVideoIdInProject,
    handleProjectCreate,
    handleProjectSelect,
    handleProjectDelete,
    handleProjectRename,
  } = useProjects({
    backendStatus,
    annotationState: { classes, instances, annotations, keyframes, scenes, videoMetadata },
    toast,
    findVideo: (id) => managedVideos.find(v => v.id === id),
    openProjectWorkspace: async (project, targetVideoId) => {
      setVideoId(targetVideoId);
      // Load project state
      setClasses(project.classes);
      setInstances(project.instances);
      setAnnotations(project.annotations);
      setKeyframes(project.keyframes);
      setScenes(project.scenes);
      setVideoMetadata(project.videoMetadata);
      await loadVideoIntoPlayer(targetVideoId);
    },
    clearWorkspace: () => {
      setVideoId("");
      setVideoUrl("");
      setAnnotations([]);
      setInstances([]);
      setKeyframes([]);
      setScenes([]);
      setClasses([]);
      setVideoMetadata({});
    },
  });

  // Auto-persist tool preferences to settings
  useEffect(() => {
    saveToolPreferences({
      autoTrack,
      autoDetect,
      useSAM2,
      showLabels,
      overlays,
      maximizeVideo,
    });
  }, [autoTrack, autoDetect, useSAM2, showLabels, overlays, maximizeVideo]);

  // Restore active project on mount
  useEffect(() => {
    const restoreActiveProject = async () => {
      if (activeProjectId && projects.length > 0 && managedVideos.length > 0) {
        const activeProject = projects.find(p => p.id === activeProjectId);
        if (!activeProject || activeProject.videoIds.length === 0) return;
        
        // Use first video in project or stored current video
        const targetVideoId = currentVideoIdInProject || activeProject.videoIds[0];
        const activeVideo = managedVideos.find(v => v.id === targetVideoId);
        if (activeVideo && activeVideo.status === 'ready' && activeVideo.metadata) {
          console.log('🔄 Restoring active project:', activeProject.name);
          setVideoId(targetVideoId);
          setCurrentVideoIdInProject(targetVideoId);
          
          // Restore annotation state from project
          setClasses(activeProject.classes);
          setInstances(activeProject.instances);
          setAnnotations(activeProject.annotations);
          setKeyframes(activeProject.keyframes);
          setScenes(activeProject.scenes);
          setVideoMetadata(activeProject.videoMetadata);
          
          // Resolve video source (cache-first, presigned S3 + background cache on miss)
          setVideoUrl(await resolveVideoSource(targetVideoId, activeVideo.filename, activeVideo.metadata));
          
          setVideoNativeWidth(activeVideo.metadata.width);
          setVideoNativeHeight(activeVideo.metadata.height);
          setTotalFrames(activeVideo.metadata.totalFrames);
        }
      }
    };
    
    restoreActiveProject();
  }, []); // Only run on mount

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

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
    // expose for SamModelPanel: it needs the id to have the service resolve the stream URL
    // (the <video> only has an unusable blob: src).
    (window as unknown as { __samVideoId?: string }).__samVideoId = videoId;
  }, [videoId]);

  // 🔍 DEBUG: Render-time state check
  useEffect(() => {
    if (!videoUrl && !videoId) {
      console.log("⚠️ Render check: Both videoUrl and videoId are empty!");
    } else {
      console.log("🔍 Render check: videoUrl exists:", !!videoUrl, "videoId exists:", !!videoId);
    }
  });

  // Keep a ref in sync with latest backends to avoid re-creating intervals
  useEffect(() => {
    backendsRef.current = backends;
  }, [backends]);

  // Check backend health periodically for all backends that need probing (single global interval)
  useEffect(() => {
    const checkHealth = async () => {
      if (isCheckingRef.current) return; // prevent overlapping probes
      isCheckingRef.current = true;
      try {
        const { selectedBackendId, selectedBackendSnapshot } = getBackendSettings();
        const currentBackendId = selectedBackendId || selectedBackendSnapshot?.id || 'local';
        const backendsToProbe = getProbeBackends(backendsRef.current, currentBackendId);
        
        for (const backend of backendsToProbe) {
          const isActiveBackend = backend.id === currentBackendId;
          try {
            const health = await checkBackendHealth(backend.url);
            const newStatus: "healthy" | "offline" = health && health.status === "healthy" ? "healthy" : "offline";

            if (isActiveBackend) {
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
            }

            setBackends(prev => updateBackendProbeStatus(prev, backend.id, newStatus));
          } catch (error) {
            if (isActiveBackend) {
              setBackendStatus("offline");
            }
            setBackends(prev => updateBackendProbeStatus(prev, backend.id, "offline"));
          }
        }
      } finally {
        isCheckingRef.current = false;
      }
    };

    // Initial check (slightly delayed to allow BackendSelector to push backends)
    const initialKick = setTimeout(() => {
      checkHealth();
    }, 250);

    // Use a single interval to probe all marked backends
    const interval = setInterval(() => {
      checkHealth();
    }, 30000);

    return () => {
      clearTimeout(initialKick);
      clearInterval(interval);
    };
  }, [toast]);


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
        const currentFrameAnnotations = annotationsAtFrame(annotations, currentFrame);

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

      const videoId = extractYoutubeId(url);
      const thumbnailUrl = youtubeThumbnail(url);

      // Dedup: if this YouTube video is already in the library, don't re-download
      const existing = managedVideos.find(
        v => v.youtubeUrl && extractYoutubeId(v.youtubeUrl) === videoId && videoId !== null
      );
      if (existing) {
        toast({
          title: "Already in library",
          description: "This YouTube video was already added.",
        });
        return;
      }

      // Initiate download
      const downloadJob = await downloadFromYouTube({ url });
      const jobId = downloadJob.job_id;
      
      // Create managed video entry (downloading state)
      const tempVideo: ManagedVideo = {
        id: jobId,
        filename: "Loading...",
        status: 'downloading',
        backendProgress: 0,
        youtubeUrl: url,
        youtubeThumbnail: thumbnailUrl,
        isActive: false,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      addVideo(tempVideo);

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
          
          // === Sync video to IndexedDB ===
          try {
            // Update to 'syncing' status
            setManagedVideos(prev => prev.map(v =>
              v.id === jobId ? {
                ...v,
                status: 'syncing' as const,
                frontendProgress: 0,
              } : v
            ));
            
            console.log("💾 Syncing video to local cache...");
            
            // Download video blob from backend
            const videoBlob = await downloadVideoFile(statusResponse.video_id, (percent) => {
              setManagedVideos(prev => prev.map(v =>
                v.id === jobId ? { ...v, frontendProgress: percent } : v
              ));
            });
            
            console.log("💾 Video downloaded, storing in IndexedDB...");
            
            // Store in IndexedDB
            await videoCache.init();
            await videoCache.set(videoInfo.filename, {
              videoId: statusResponse.video_id,
              filename: videoInfo.filename,
              blob: videoBlob,
              metadata: {
                duration: videoInfo.duration,
                fps: videoInfo.fps,
                width: videoInfo.width,
                height: videoInfo.height,
                totalFrames: videoInfo.total_frames,
                cachedAt: Date.now(),
              }
            });
            
            console.log("💾 Video cached successfully!");
            
          } catch (cacheError) {
            console.error("💾 Failed to cache video:", cacheError);
            // Don't block - video is still on backend
          }
          
          // Update managed video with final video_id and metadata
          setManagedVideos(prev => prev.map(v =>
            v.id === jobId ? {
              id: statusResponse.video_id!,
              filename: videoInfo.filename,
              status: 'ready' as const,
              youtubeUrl: v.youtubeUrl,
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

  // Resolve a playable URL — decision flow lives in lib/videoSource (tested);
  // this wrapper just binds the real cache/API/blob-tracking dependencies.
  const resolveVideoSource = async (
    videoId: string,
    filename: string,
    metadata?: VideoSourceMetadata
  ): Promise<string> => {
    await videoCache.init().catch(() => {});
    return resolveVideoSourceCore(videoId, filename, metadata, {
      getCached: (f) => videoCache.get(f),
      cacheVideo: (f, entry) => videoCache.set(f, entry),
      downloadVideo: (id) => downloadVideoFile(id),
      getStreamUrl: (id) => getVideoStreamUrl(id),
      createObjectURL: (blob) => URL.createObjectURL(blob),
      trackBlobUrl: (url) => blobUrlsRef.current.add(url),
      fallbackUrl: (id) => `${config.backendUrl}/api/videos/${id}/download`,
      now: () => Date.now(),
    });
  };

  // Helper function to load video into player
  const loadVideoIntoPlayer = async (videoId: string) => {
    const video = managedVideos.find(v => v.id === videoId);
    if (!video || !video.metadata) return;

    setVideoUrl(await resolveVideoSource(videoId, video.filename, video.metadata));
    
    setVideoNativeWidth(video.metadata.width);
    setVideoNativeHeight(video.metadata.height);
    setTotalFrames(video.metadata.totalFrames);
    
    // Update last accessed time
    setManagedVideos(prev => prev.map(v =>
      v.id === videoId ? { ...v, isActive: true, lastAccessedAt: Date.now() } : { ...v, isActive: false }
    ));
  };

  const handleVideoSelect = async (videoId: string) => {
    const video = managedVideos.find(v => v.id === videoId);
    if (!video || video.status !== 'ready' || !video.metadata) return;

    // Check if video is already in active project
    const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;
    if (activeProject && activeProject.videoIds.includes(videoId)) {
      // Switch to this video within the project
      setVideoId(videoId);
      setCurrentVideoIdInProject(videoId);
      await loadVideoIntoPlayer(videoId);
      toast({
        title: "Switched video",
        description: `Now viewing ${video.filename} in ${activeProject.name}`,
      });
      return;
    }

    // Check if video belongs to a different project
    let project = projects.find(p => p.videoIds.includes(videoId));
    
    if (!project) {
      // Create new project with this video
      project = createEmptyProject(video.filename.replace(/\.[^/.]+$/, ""), [videoId]);
      
      if (backendStatus === 'healthy') {
        try {
          const response = await createProject({
            name: project.name,
            video_id: videoId, // Backend still expects single video
            description: `Annotation project for ${video.filename}`,
          });
          
          project.id = response.id;
          project.createdAt = new Date(response.created_at).getTime();
          project.lastModified = new Date(response.last_modified).getTime();
        } catch (error) {
          console.error('Failed to create project on backend, using local storage:', error);
        }
      }
      
      setProjects(prev => [...prev, project!]);
      
      toast({
        title: "Project created",
        description: `New project "${project.name}" created`,
      });
    }
    
    // Switch to this project
    setActiveProjectId(project.id);
    setCurrentVideoIdInProject(videoId);
    
    // Load project state
    setClasses(project.classes);
    setInstances(project.instances);
    setAnnotations(project.annotations);
    setKeyframes(project.keyframes);
    setScenes(project.scenes);
    setVideoMetadata(project.videoMetadata);
    setSelectedClassId(undefined);
    setSelectedAnnotationId(undefined);
    setSelectedScene(null);
    setTrackingJobs([]);
    setCurrentFrame(0);
    setVideoMetadata({});

    // Set video
    setVideoId(videoId);
    await loadVideoIntoPlayer(videoId);
    
    toast({
      title: "Video loaded",
      description: `${video.filename}`,
    });
  };
  
  const handleVideoAddToProject = (videoId: string) => {
    if (!activeProjectId) {
      toast({
        title: "No active project",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    const video = managedVideos.find(v => v.id === videoId);
    if (!video) return;

    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId && !p.videoIds.includes(videoId)) {
        return {
          ...p,
          videoIds: [...p.videoIds, videoId],
          lastModified: Date.now(),
        };
      }
      return p;
    }));

    toast({
      title: "Video added",
      description: `${video.filename} added to project`,
    });
  };

  const handleVideoRemoveFromProject = (videoId: string) => {
    if (!activeProjectId) return;

    const project = projects.find(p => p.id === activeProjectId);
    if (!project) return;

    if (project.videoIds.length <= 1) {
      toast({
        title: "Cannot remove video",
        description: "Project must contain at least one video",
        variant: "destructive",
      });
      return;
    }

    const video = managedVideos.find(v => v.id === videoId);

    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        return {
          ...p,
          videoIds: p.videoIds.filter(id => id !== videoId),
          lastModified: Date.now(),
        };
      }
      return p;
    }));

    // If removing active video, switch to first remaining video
    if (videoId === videoId) {
      const remainingVideoIds = project.videoIds.filter(id => id !== videoId);
      if (remainingVideoIds.length > 0) {
        handleVideoSelect(remainingVideoIds[0]);
      }
    }

    toast({
      title: "Video removed",
      description: video ? `${video.filename} removed from project` : "Video removed from project",
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
    addVideo(tempVideo);

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
    async (x: number, y: number, displayWidth: number, displayHeight: number, ctrlKey: boolean, altKey: boolean, shiftKey: boolean = false) => {
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

      // Guard: some load paths leave native dims unset → pctToNative would
      // yield NaN and SAM2 would 422. Fall back to the active video's metadata.
      let nativeW = videoNativeWidth;
      let nativeH = videoNativeHeight;
      if (!nativeW || !nativeH || Number.isNaN(nativeW) || Number.isNaN(nativeH)) {
        const active = managedVideos.find(v => v.id === videoId);
        nativeW = active?.metadata?.width || 1280;
        nativeH = active?.metadata?.height || 720;
      }

      // Convert percentage (0-100) to native video pixel coordinates
      const { x: videoX, y: videoY } = pctToNative(x, y, nativeW, nativeH);

      console.log('🎯 Mapped to native coords:', { videoX, videoY, nativeW, nativeH });

      // Determine prompt type. Desktop: Ctrl = +, Alt/Alt-Gr = −. Mobile (no
      // keyboard): fall back to the tap-mode toggle (promptTapMode).
      const promptType = resolvePromptType(ctrlKey, altKey, promptTapMode);

      if (!promptType) {
        toast({
          title: "Pick a prompt mode",
          description: "Tap the +/− toggle to place prompts, or hold Ctrl (+) / Alt (−) while clicking.",
        });
        return;
      }
      const isNegative = promptType === 'negative';

      // Check if clicking on an existing annotation to add a prompt.
      // Shift forces a brand-new object even when the click lands inside an
      // existing bbox (so overlapping objects can be started on the same frame).
      const clickedAnnotation = shiftKey ? undefined : annotations.find(ann => {
        if (!ann.bbox || ann.frameCreated !== currentFrame) return false;
        const { x: bx, y: by, w: bw, h: bh } = ann.bbox;
        return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      });

      // Clicking an existing annotation: add the prompt AND re-run SAM2 with the
      // full prompt set, so negative clicks actually refine the mask.
      if (clickedAnnotation) {
        const updatedPrompts = [
          ...(clickedAnnotation.sam2Prompts || []),
          { x, y, type: promptType },
        ];

        // Persist the new prompt immediately
        setAnnotations(prev => prev.map(ann =>
          ann.id === clickedAnnotation.id ? { ...ann, sam2Prompts: updatedPrompts } : ann
        ));

        if (!useSAM2 || !videoId) {
          toast({
            title: `${isNegative ? '−' : '+'} prompt added`,
            description: useSAM2 ? "No video loaded — mask not updated." : "Enable SAM2 to update the mask.",
          });
          return;
        }

        // SAM2 needs at least one positive point
        if (!updatedPrompts.some(p => p.type === 'positive')) {
          toast({
            title: "Add a positive prompt first",
            description: "SAM2 needs at least one + point before refining with − points.",
            variant: "destructive",
          });
          return;
        }

        toast({ title: `${isNegative ? '−' : '+'} prompt added`, description: "Updating segmentation…" });
        try {
          const click_prompts = updatedPrompts.map(p => {
            const n = pctToNative(p.x, p.y, nativeW, nativeH);
            return { x: n.x, y: n.y, type: p.type };
          });
          const sam2Response = await segmentWithSAM2({
            video_id: videoId,
            frame_number: currentFrame,
            click_prompts,
          });
          const results = (sam2Response as any).results;
          if (results?.bbox) {
            const [x1, y1, x2, y2] = results.bbox as [number, number, number, number];
            const newBbox = nativeBBoxToPct([x1, y1, x2, y2], nativeW, nativeH);
            setAnnotations(prev => prev.map(ann =>
              ann.id === clickedAnnotation.id
                ? { ...ann, bbox: newBbox, maskBBox: newBbox, maskBase64: results.mask_base64, points: bboxToPolygon(newBbox) }
                : ann
            ));
            const pos = updatedPrompts.filter(p => p.type === 'positive').length;
            const neg = updatedPrompts.filter(p => p.type === 'negative').length;
            toast({ title: "Segmentation updated", description: `${pos}+ / ${neg}− prompts` });
          }
        } catch (error) {
          console.error('SAM2 re-segment failed:', error);
          toast({
            title: "Segmentation update failed",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        }
        return;
      }

      // If SAM2 is enabled and no existing annotation clicked, create new one
      if (useSAM2) {
        console.log('🎯 SAM2 enabled, checking videoId:', videoId);
        
        // Don't create new annotations with negative prompts
        if (isNegative) {
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

        // A new object takes the class the user has selected as active. (No auto
        // "Sail" default and no DINO guess — the human selection is ground truth.)
        const selectedClass = classes.find(c => c.id === selectedClassId);
        if (!selectedClass) {
          toast({
            title: "Select a class first",
            description: "Pick (or create) the class this object belongs to, then click to segment it.",
            variant: "destructive",
          });
          return;
        }

        // Show loading toast
        toast({
          title: `Running SAM2 segmentation...`,
          description: `Segmenting a new ${selectedClass.name}`,
        });

        // Convert percentage (0-100) to native video pixel coordinates for backend
        const { x: videoX, y: videoY } = pctToNative(x, y, nativeW, nativeH);

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
          
          // Backend returns native-resolution corners; normalize to display %
          const bbox = nativeBBoxToPct([x1, y1, x2, y2], nativeW, nativeH);
          
          // Keep mask for later
          const maskPixels = results.mask_pixels;
          
          // TODO: Convert mask_base64 PNG to polygon contour points for better visualization
          const points = bboxToPolygon(bbox);
          
          console.log('📊 Extracted segmentation:', { 
            bbox, 
            points: points.length, 
            maskPixels,
            score: results.score,
            clickPercentage: { x: x.toFixed(2), y: y.toFixed(2) },
            clickNative: { x: videoX, y: videoY },
            nativeResolution: `${videoNativeWidth}×${videoNativeHeight}`
          });
          
          // The new object belongs to the user's active class (guarded above).
          const classData = selectedClass;
          const className = classData.name;

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
    [currentFrame, selectedClassId, classes, instances, toast, autoTrack, keyframes, useSAM2, colorIndex, videoId, videoNativeWidth, videoNativeHeight, promptTapMode, annotations]
  );

  // Delete a SAM2 prompt AND re-run segmentation on the remaining prompts, so
  // removing a (e.g. negative) point actually reverts/updates the mask instead of
  // leaving it stale. Mirrors the re-segment path in handleCanvasClick's
  // existing-annotation branch. Falls back to a plain delete when SAM2/video is
  // unavailable or no positive prompt remains (SAM2 needs at least one +).
  const handleDeletePromptResegment = async (annotationId: string, promptIndex: number) => {
    const annotation = annotations.find(a => a.id === annotationId);
    const remaining = (annotation?.sam2Prompts || []).filter((_, i) => i !== promptIndex);

    // Remove the prompt from state (+ shows the "Prompt deleted" toast)
    handleDeletePrompt(annotationId, promptIndex);

    if (!annotation || !useSAM2 || !videoId) return;
    if (!remaining.some(p => p.type === 'positive')) {
      // Nothing to segment from — leave the existing mask as-is.
      return;
    }

    // Guard native dims the same way handleCanvasClick does.
    let nativeW = videoNativeWidth;
    let nativeH = videoNativeHeight;
    if (!nativeW || !nativeH || Number.isNaN(nativeW) || Number.isNaN(nativeH)) {
      const active = managedVideos.find(v => v.id === videoId);
      nativeW = active?.metadata?.width || 1280;
      nativeH = active?.metadata?.height || 720;
    }

    try {
      const click_prompts = remaining.map(p => {
        const n = pctToNative(p.x, p.y, nativeW, nativeH);
        return { x: n.x, y: n.y, type: p.type };
      });
      const sam2Response = await segmentWithSAM2({
        video_id: videoId,
        frame_number: annotation.frameCreated,
        click_prompts,
      });
      const results = (sam2Response as any).results;
      if (results?.bbox) {
        const [x1, y1, x2, y2] = results.bbox as [number, number, number, number];
        const newBbox = nativeBBoxToPct([x1, y1, x2, y2], nativeW, nativeH);
        setAnnotations(prev => prev.map(ann =>
          ann.id === annotationId
            ? { ...ann, bbox: newBbox, maskBBox: newBbox, maskBase64: results.mask_base64, points: bboxToPolygon(newBbox) }
            : ann
        ));
        const pos = remaining.filter(p => p.type === 'positive').length;
        const neg = remaining.filter(p => p.type === 'negative').length;
        toast({ title: "Segmentation updated", description: `${pos}+ / ${neg}− prompts` });
      }
    } catch (error) {
      console.error('SAM2 re-segment after delete failed:', error);
      toast({
        title: "Segmentation update failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleContextMenu = (x: number, y: number, context: any) => {
    setContextMenu({ x, y, context });
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

  const handleExportData = async () => {
    if (!videoId) {
      toast({ title: "No video", description: "Open a video before exporting.", variant: "destructive" });
      return;
    }
    if (classes.length === 0 || annotations.length === 0) {
      toast({ title: "Nothing to export", description: "Add classes and annotations first.", variant: "destructive" });
      return;
    }

    toast({ title: "Exporting dataset…", description: "Saving annotations and building the YOLO dataset." });
    try {
      const activeProject = projects.find((p) => p.id === activeProjectId);
      const res = await exportProjectAsYolo({
        projectName: activeProject?.name ?? "windsurf-project",
        videoId,
        classes,
        instances,
        annotations,
        api: { createBackendProject, createBackendClass, saveBackendAnnotations, exportDataset },
      });

      const url = res.result?.url;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      const { images, boxes, splits } = res.stats;
      toast({
        title: "Dataset exported",
        description: `${images} images, ${boxes} boxes (${splits.train ?? 0} train / ${splits.val ?? 0} val) — ${res.sink}`,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // === Additional Project Management Handlers (v2) ===
  const handleAddVideosToProject = (videoIds: string[]) => {
    if (!activeProjectId) {
      toast({
        title: "No active project",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const newVideoIds = [...(p.videoIds || [])];
        videoIds.forEach(id => {
          if (!newVideoIds.includes(id)) {
            newVideoIds.push(id);
          }
        });
        return { ...p, videoIds: newVideoIds, lastModified: Date.now() };
      }
      return p;
    }));

    toast({
      title: "Videos added to project",
      description: `${videoIds.length} video${videoIds.length > 1 ? 's' : ''} added`,
    });

    setShowAddResources(false);
  };

  const handleRemoveVideoFromProject = (videoId: string) => {
    if (!activeProjectId) return;

    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        return {
          ...p,
          videoIds: (p.videoIds || []).filter(id => id !== videoId),
          lastModified: Date.now(),
        };
      }
      return p;
    }));

    toast({
      title: "Video removed from project",
    });
  };

  const handleLoadVideoInProject = async (videoId: string) => {
    const video = managedVideos.find(v => v.id === videoId);
    if (!video || video.status !== 'ready' || !video.metadata) {
      toast({
        title: "Video not ready",
        description: "Please wait for the video to finish processing",
        variant: "destructive",
      });
      return;
    }

    // Use the existing handleVideoSelect
    await handleVideoSelect(videoId);
    setCurrentVideoIdInProject(videoId);
    setShowProjectManager_v2(false);
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <SamModelPanel />
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="px-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center ml-1 mr-2 sm:mr-4 my-1">
                <img
                  src={logos[currentLogoIndex]}
                  alt="LabelBee Logo"
                  className="h-12 sm:h-16 w-auto cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setCurrentLogoIndex((prev) => (prev + 1) % logos.length)}
                />
                <span className="text-[10px] leading-none text-muted-foreground font-mono">v{APP_VERSION}</span>
              </div>
              <div>
                <h1 className="text-base sm:text-xl font-bold">
                  AI Annotation
                </h1>
              </div>
            </div>
            {/* Right cluster per docs/UX_ARCHITECTURE.md: project (primary),
                help, dev (compact), then the single identity control. Export is
                project-scoped → it lives in the Project Manager, not here. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowProjectManager_v2(true)}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowShortcuts(true)}
              >
                <Keyboard className="h-4 w-4 mr-2" />
                Shortcuts
              </Button>
              <BackendSelector
                backendStatus={backendStatus}
                onBackendsChange={setBackends}
                probeStatuses={Object.fromEntries(backends.filter(b => b.probeStatus).map(b => [b.id, b.probeStatus!]))}
              />
              <UserMenu />
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
          <div className={`grid grid-cols-1 lg:grid-cols-12 ${maximizeVideo ? "gap-0" : "gap-3"}` }>
            {/* Left sidebar - Controls */}
            <div className={maximizeVideo ? "hidden" : "lg:col-span-2 space-y-4"}>
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
            <div className={maximizeVideo ? "lg:col-span-12 space-y-4 min-w-0" : "lg:col-span-8 space-y-4 min-w-0"}>
              {/* Tap-to-place prompt mode — touch/mobile only (desktop uses Ctrl/Alt) */}
              {selectedTool === "annotate" && (
                <div className="sm:hidden flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Tap places:</span>
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPromptTapMode(m => (m === "positive" ? null : "positive"))}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        promptTapMode === "positive"
                          ? "bg-green-500/20 text-green-500"
                          : "bg-card text-muted-foreground hover:bg-muted"
                      }`}
                      aria-pressed={promptTapMode === "positive"}
                    >
                      ＋ Positive
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptTapMode(m => (m === "negative" ? null : "negative"))}
                      className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
                        promptTapMode === "negative"
                          ? "bg-red-500/20 text-red-500"
                          : "bg-card text-muted-foreground hover:bg-muted"
                      }`}
                      aria-pressed={promptTapMode === "negative"}
                    >
                      － Negative
                    </button>
                  </div>
                  {promptTapMode && (
                    <span className="text-xs text-muted-foreground">
                      Tap the video to add {promptTapMode} prompts
                    </span>
                  )}
                </div>
              )}
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
                  // Ground-truth native resolution from the actual video element
                  // — overrides any stale/missing backend metadata so click
                  // prompts scale to the real pixel grid.
                  if (metadata.width && metadata.height) {
                    setVideoNativeWidth(metadata.width);
                    setVideoNativeHeight(metadata.height);
                  }
                }}
                onCanvasClick={handleCanvasClick}
                classes={classes}
                instances={instances}
                annotations={annotations}
                onAnnotationUpdate={handleAnnotationUpdate}
                onAnnotationSelect={setSelectedAnnotationId}
                overlays={overlays}
                selectedTool={selectedTool}
                selectedAnnotationId={selectedAnnotationId}
                onContextMenu={handleContextMenu}
                showLabels={showLabels}
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
            <div className={maximizeVideo ? "hidden" : "lg:col-span-2 min-w-0"}>
              <Tabs defaultValue="scenes" className="h-full w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="scenes">Scenes</TabsTrigger>
                  <TabsTrigger value="tracking">Tracking</TabsTrigger>
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
                    videoId={videoId}
                    videoFilename={
                      videoId
                        ? managedVideos.find(v => v.id === videoId)?.filename
                        : undefined
                    }
                    videoFps={
                      videoId
                        ? managedVideos.find(v => v.id === videoId)?.metadata?.fps
                        : undefined
                    }
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
                    onFrameChange={setCurrentFrame}
                  />
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
          onDeletePrompt={handleDeletePromptResegment}
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
      <ProjectManager
        open={videoManagerOpen}
        onOpenChange={setVideoManagerOpen}
        videos={managedVideos}
        activeProject={activeProjectId ? projects.find(p => p.id === activeProjectId) || null : null}
        activeVideoId={videoId}
        onVideoSelect={handleVideoSelect}
        onVideoDelete={handleVideoDelete}
        onVideoAddToProject={handleVideoAddToProject}
        onVideoRemoveFromProject={handleVideoRemoveFromProject}
        onFileSelect={processVideoFile}
        onYoutubeUrl={handleYoutubeUrl}
        isUploading={isUploading}
        hasUnsavedChanges={
          classes.length > 0 || 
          instances.length > 0 || 
          annotations.length > 0 || 
          keyframes.length > 0 || 
          scenes.length > 0
        }
      />

      {/* New Project Management System */}
      <ProjectManager_v2
        open={showProjectManager_v2}
        onOpenChange={setShowProjectManager_v2}
        activeProject={activeProjectId ? projects.find(p => p.id === activeProjectId) || null : null}
        videos={managedVideos}
        currentVideoId={videoId}
        onOpenAddResources={() => setShowAddResources(true)}
        onOpenProjectSwitcher={() => setShowProjectSwitcher(true)}
        onLoadVideo={handleLoadVideoInProject}
        onRemoveVideo={handleRemoveVideoFromProject}
        onRenameProject={handleProjectRename}
        onExport={handleExportData}
      />

      <AddResourcesDialog
        open={showAddResources}
        onOpenChange={setShowAddResources}
        projectVideoIds={activeProjectId ? (projects.find(p => p.id === activeProjectId)?.videoIds || []) : []}
        availableVideos={managedVideos}
        onAddToProject={handleAddVideosToProject}
        onDeleteVideos={deleteVideosFromCache}
        onFileSelect={processVideoFile}
        onYoutubeUrl={handleYoutubeUrl}
        isUploading={isUploading}
      />

      <ProjectSwitcher
        open={showProjectSwitcher}
        onOpenChange={setShowProjectSwitcher}
        projects={projects}
        activeProjectId={activeProjectId}
        onProjectSelect={handleProjectSelect}
        onProjectCreate={handleProjectCreate}
        onProjectDelete={handleProjectDelete}
        onProjectRename={handleProjectRename}
      />
      
      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">Video Navigation</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Play/Pause</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Space</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Previous Frame</span>
                  <kbd className="px-2 py-1 bg-muted rounded">←</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Next Frame</span>
                  <kbd className="px-2 py-1 bg-muted rounded">→</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Skip Back 30 Frames</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Shift + ←</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Skip Forward 30 Frames</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Shift + →</kbd>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2">Keyframes</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Add START Keyframe</span>
                  <kbd className="px-2 py-1 bg-muted rounded">S</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Add STOP Keyframe</span>
                  <kbd className="px-2 py-1 bg-muted rounded">E</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Add SKIP Keyframe</span>
                  <kbd className="px-2 py-1 bg-muted rounded">X</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Add META Keyframe</span>
                  <kbd className="px-2 py-1 bg-muted rounded">T</kbd>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2">Tools</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Annotate Tool</span>
                  <kbd className="px-2 py-1 bg-muted rounded">A</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Select Tool</span>
                  <kbd className="px-2 py-1 bg-muted rounded">V</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Edit Tool</span>
                  <kbd className="px-2 py-1 bg-muted rounded">P</kbd>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2">Annotation</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Add Positive Prompt</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Ctrl + Click</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Add Negative Prompt</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Alt + Click</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Cycle Annotations (Edit Mode)</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Tab</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Delete Annotation</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Delete / Backspace</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Cancel / Deselect</span>
                  <kbd className="px-2 py-1 bg-muted rounded">Esc</kbd>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
