import { useState, useEffect, useCallback } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { AnnotationControls } from "@/components/AnnotationControls";
import { KeyframeManager } from "@/components/KeyframeManager";
import { Timeline } from "@/components/Timeline";
import { ScenesManager } from "@/components/ScenesManager";
import { Toolbox, type ToolMode } from "@/components/Toolbox";
import { ContextMenu } from "@/components/ContextMenu";
import { TrackingJobs, type TrackingJob } from "@/components/TrackingJobs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Upload, Keyboard } from "lucide-react";

interface Annotation {
  id: string;
  color: string;
  colorName: string;
  points: Array<{ x: number; y: number }>;
  bbox?: { x: number; y: number; w: number; h: number };
  frameCreated: number;
  trackedFrames?: Array<[number, number]>; // Array of [start, end] ranges where object is tracked
}

interface Keyframe {
  frame: number;
  type: "START" | "STOP" | "SKIP";
  timestamp: string;
}

interface Scene {
  id: string;
  startFrame: number;
  endFrame: number;
  quality: "good" | "bad" | "unknown";
}

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
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(3000);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [isDetectingScenes, setIsDetectingScenes] = useState(false);
  const [overlays, setOverlays] = useState({
    segments: true,
    bboxes: true,
    points: true,
  });
  const [colorIndex, setColorIndex] = useState(0);
  const [selectedTool, setSelectedTool] = useState<ToolMode>("annotate");
  const [autoTrack, setAutoTrack] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    context: any;
  } | null>(null);
  const [trackingJobs, setTrackingJobs] = useState<TrackingJob[]>([]);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);

  // Frame range for timeline (defaults to full video, or zooms to selected scene)
  const frameRange: [number, number] = selectedScene 
    ? [selectedScene.startFrame, selectedScene.endFrame]
    : [0, totalFrames];

  // Auto-create tracking jobs from START->STOP keyframe pairs
  useEffect(() => {
    const sortedKeyframes = [...keyframes].sort((a, b) => a.frame - b.frame);
    const newJobs: TrackingJob[] = [];
    
    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].type === "START") {
        const startFrame = sortedKeyframes[i].frame;
        const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");
        
        if (stopKeyframe) {
          const jobId = `segment-${startFrame}-${stopKeyframe.frame}`;
          
          // Check if job already exists
          const jobExists = trackingJobs.some(job => job.id === jobId);
          
          if (!jobExists) {
            // Find annotations created in this segment
            const segmentAnnotations = annotations
              .filter(ann => ann.frameCreated >= startFrame && ann.frameCreated <= stopKeyframe.frame)
              .map(ann => ann.id);
            
            newJobs.push({
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
    
    if (newJobs.length > 0) {
      setTrackingJobs(prev => [...prev, ...newJobs]);
    }
  }, [keyframes, annotations]);

  // Auto-detect DINO on frame change
  useEffect(() => {
    if (autoDetect && videoUrl) {
      // TODO: Call DINO detection API
      console.log("Auto-detecting objects at frame", currentFrame);
    }
  }, [currentFrame, autoDetect, videoUrl]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Close context menu on ESC
      if (e.key === "Escape" && contextMenu) {
        setContextMenu(null);
        return;
      }
      // Ignore if typing in input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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
      }

      // Save project
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveProject();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [totalFrames, currentFrame]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      toast({
        title: "Video loaded",
        description: "Ready to annotate",
      });
      // Auto-detect scenes on load (mock implementation)
      setTimeout(() => handleDetectScenes(), 1000);
    }
  };

  const handleDetectScenes = () => {
    setIsDetectingScenes(true);
    
    // Mock scene detection - in real version, this would use PySceneDetect
    setTimeout(() => {
      const mockScenes: Scene[] = [
        { id: "scene-1", startFrame: 0, endFrame: 450, quality: "unknown" },
        { id: "scene-2", startFrame: 451, endFrame: 920, quality: "unknown" },
        { id: "scene-3", startFrame: 921, endFrame: 1580, quality: "unknown" },
        { id: "scene-4", startFrame: 1581, endFrame: 2100, quality: "unknown" },
        { id: "scene-5", startFrame: 2101, endFrame: 3000, quality: "unknown" },
      ];
      
      setScenes(mockScenes);
      setIsDetectingScenes(false);
      toast({
        title: "Scenes detected",
        description: `Found ${mockScenes.length} scenes`,
      });
    }, 2000);
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

  const handleCanvasClick = useCallback(
    (x: number, y: number) => {
      // Check if click is inside an existing annotation
      const clickedAnnotation = annotations.find((ann) => {
        if (!ann.bbox) return false;
        const { x: bx, y: by, w: bw, h: bh } = ann.bbox;
        return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      });

      if (clickedAnnotation) {
        setSelectedAnnotationId(clickedAnnotation.id);
        toast({
          title: "Annotation selected",
          description: "Click outside to create new annotation",
        });
        return;
      }

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

      const color = SAIL_COLORS[colorIndex % SAIL_COLORS.length];
      const newAnnotation: Annotation = {
        id: `ann-${Date.now()}`,
        color: color.hex,
        colorName: color.name,
        points,
        bbox: {
          x: x - radius,
          y: y - radius,
          w: radius * 2,
          h: radius * 2,
        },
        frameCreated: currentFrame,
      };

      setAnnotations((prev) => [...prev, newAnnotation]);
      setColorIndex((prev) => prev + 1);
      setSelectedAnnotationId(newAnnotation.id);

      // Auto-create START keyframe if auto-track is enabled
      if (autoTrack) {
        const existingKeyframe = keyframes.find(k => k.frame === currentFrame);
        if (!existingKeyframe || existingKeyframe.type !== "START") {
          handleAddKeyframe("START");
          toast({
            title: "Annotation added with START keyframe",
            description: `${color.name} sail at frame ${currentFrame}`,
          });
        } else {
          toast({
            title: "Annotation added",
            description: `${color.name} sail at frame ${currentFrame}`,
          });
        }
      } else {
        toast({
          title: "Annotation added",
          description: `${color.name} sail at frame ${currentFrame}`,
        });
      }
    },
    [currentFrame, colorIndex, toast, annotations, autoTrack, keyframes]
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

  const handleProcessJob = (jobId: string) => {
    const job = trackingJobs.find(j => j.id === jobId);
    if (!job) return;

    setTrackingJobs(jobs =>
      jobs.map(job =>
        job.id === jobId ? { ...job, status: "processing" as const, progress: 0 } : job
      )
    );

    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setTrackingJobs(jobs =>
        jobs.map(job =>
          job.id === jobId ? { ...job, progress } : job
        )
      );

      if (progress >= 100) {
        clearInterval(interval);
        setTrackingJobs(jobs =>
          jobs.map(job =>
            job.id === jobId ? { ...job, status: "completed" as const } : job
          )
        );
        
        // Update annotations with tracked frames
        setAnnotations(prevAnnotations =>
          prevAnnotations.map(ann => {
            if (job.objectIds.includes(ann.id)) {
              const trackedFrames = ann.trackedFrames || [];
              const newRange: [number, number] = [job.startFrame, job.stopFrame];
              return {
                ...ann,
                trackedFrames: [...trackedFrames, newRange],
              };
            }
            return ann;
          })
        );
        
        toast({
          title: "Tracking completed",
          description: `Tracked ${job.objectIds.length} object(s) from frame ${job.startFrame} to ${job.stopFrame}`,
        });
      }
    }, 500);
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

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    toast({
      title: "Annotation deleted",
    });
  };

  const handleAddKeyframe = (type: "START" | "STOP" | "SKIP") => {
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
  };

  const handleDeleteKeyframe = (frame: number) => {
    setKeyframes((prev) => prev.filter((k) => k.frame !== frame));
  };

  const handleSaveProject = () => {
    const project = {
      version: "0.2.5",
      videoUrl,
      currentFrame,
      totalFrames,
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
      description: "Annotations exported to JSON",
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
              <p className="text-sm text-muted-foreground">v0.2.5 - Professional sail tracking</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Keyboard className="h-4 w-4 mr-2" />
                Shortcuts
              </Button>
              <label>
                <Button variant="default" size="sm" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    {videoUrl ? "Change Video" : "Load Video"}
                  </span>
                </Button>
                <Input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleVideoUpload}
                />
              </label>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-6">
        {!videoUrl ? (
          <div className="flex items-center justify-center min-h-[600px]">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold">Load a video to begin</h2>
              <p className="text-muted-foreground max-w-md">
                Upload a video file to start annotating sails with multi-AI analysis support
              </p>
              <label>
                <Button variant="default" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose Video File
                  </span>
                </Button>
                <Input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleVideoUpload}
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left sidebar - Controls */}
            <div className="col-span-3 space-y-4">
              <Toolbox
                selectedTool={selectedTool}
                onToolChange={setSelectedTool}
                autoTrack={autoTrack}
                onAutoTrackChange={setAutoTrack}
                autoDetect={autoDetect}
                onAutoDetectChange={setAutoDetect}
              />
              <AnnotationControls
                annotations={annotations}
                currentFrame={currentFrame}
                overlays={overlays}
                onToggleOverlay={handleToggleOverlay}
                onDeleteAnnotation={handleDeleteAnnotation}
                onSelectAnnotation={setSelectedAnnotationId}
                selectedAnnotationId={selectedAnnotationId}
              />
            </div>

            {/* Center - Video player & Timeline */}
            <div className="col-span-6 space-y-4">
              <VideoPlayer
                videoUrl={videoUrl}
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                frameRange={frameRange}
                onFrameChange={setCurrentFrame}
                onVideoMetadata={(metadata) => {
                  setTotalFrames(metadata.totalFrames);
                  toast({
                    title: "Video loaded",
                    description: `${metadata.totalFrames} frames at ${metadata.fps} fps`,
                  });
                }}
                onCanvasClick={handleCanvasClick}
                annotations={annotations}
                onAnnotationUpdate={(id, updates) => {
                  setAnnotations(prev => 
                    prev.map(ann => ann.id === id ? { ...ann, ...updates } : ann)
                  );
                }}
                overlays={overlays}
                selectedTool={selectedTool}
                selectedAnnotationId={selectedAnnotationId}
                onContextMenu={handleContextMenu}
              />
              <Timeline
                annotations={annotations}
                keyframes={keyframes}
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                frameRange={frameRange}
                onFrameChange={setCurrentFrame}
                selectedScene={selectedScene}
                onClearScene={() => {
                  setSelectedScene(null);
                  toast({
                    title: "Timeline reset",
                    description: "Showing full video range",
                  });
                }}
              />
            </div>

            {/* Right sidebar - Scenes & Tracking tabs */}
            <div className="col-span-3">
              <Tabs defaultValue="tracking" className="h-full">
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
                    isDetecting={isDetectingScenes}
                  />
                </TabsContent>
                <TabsContent value="tracking" className="mt-4 space-y-4">
                  <KeyframeManager
                    keyframes={keyframes}
                    currentFrame={currentFrame}
                    onAddKeyframe={handleAddKeyframe}
                    onDeleteKeyframe={handleDeleteKeyframe}
                    onSaveProject={handleSaveProject}
                    onExportData={handleExportData}
                  />
                  <TrackingJobs
                    jobs={trackingJobs}
                    onProcessJob={handleProcessJob}
                    onDeleteJob={handleDeleteJob}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </main>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          context={contextMenu.context}
          onClose={() => setContextMenu(null)}
          onDeleteAnnotation={handleDeleteAnnotation}
          onDeleteKeyframe={handleDeleteKeyframe}
          onAddKeyframe={handleAddKeyframe}
          onStartTracking={handleStartTracking}
        />
      )}
    </div>
  );
};

export default Index;
