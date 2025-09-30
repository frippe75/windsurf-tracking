import { useState, useEffect, useCallback } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { ClassManager } from "@/components/ClassManager";
import { KeyframeManager } from "@/components/KeyframeManager";
import { HierarchicalTimeline } from "@/components/HierarchicalTimeline";
import { ScenesManager } from "@/components/ScenesManager";
import { Toolbox, type ToolMode } from "@/components/Toolbox";
import { ContextMenu } from "@/components/ContextMenu";
import { TrackingJobs, type TrackingJob } from "@/components/TrackingJobs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Upload, Keyboard } from "lucide-react";
import { Class, Instance, Annotation, Keyframe, Scene } from "@/types/annotation";

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    context: any;
  } | null>(null);
  const [trackingJobs, setTrackingJobs] = useState<TrackingJob[]>([]);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();

  // Frame range for timeline (defaults to full video, or zooms to selected scene)
  const frameRange: [number, number] = selectedScene 
    ? [selectedScene.startFrame, selectedScene.endFrame]
    : [0, totalFrames];

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
  }, [totalFrames, currentFrame, keyframes, selectedTool, annotations, selectedAnnotationId]);

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

  // Mock SAM2 segmentation - simulates backend call
  // Creates bbox 5-15% of canvas size with 3-6 point polygon inside
  const mockSAM2Segmentation = async (x: number, y: number, canvasWidth: number, canvasHeight: number): Promise<{
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
    async (x: number, y: number, videoWidth: number, videoHeight: number) => {
      // If SAM2 is enabled, use it regardless of class selection
      if (useSAM2) {
        // Show loading toast
        toast({
          title: "Running SAM2 segmentation...",
          description: "Detecting object boundary and class",
        });

        try {
          // Call mock SAM2 backend with actual video dimensions
          const { points, className } = await mockSAM2Segmentation(x, y, videoWidth, videoHeight);

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

          // Calculate bounding box from segmentation points
          const xs = points.map(p => p.x);
          const ys = points.map(p => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);

          // Create new instance for this class
          const classInstances = instances.filter(inst => inst.classId === classData.id);
          const instanceNumber = classInstances.length + 1;
          const newInstance: Instance = {
            id: `inst-${Date.now()}`,
            classId: classData.id,
            instanceNumber,
            metadata: {},
          };

          // Create annotation for this instance
          const newAnnotation: Annotation = {
            id: `ann-${Date.now()}`,
            instanceId: newInstance.id,
            points,
            bbox: {
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
            },
            frameCreated: currentFrame,
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
          toast({
            title: "Segmentation failed",
            description: "Could not segment object",
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
    [currentFrame, selectedClassId, classes, instances, toast, autoTrack, keyframes, useSAM2, colorIndex]
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

    // ========================================
    // FAKE TRACKING SIMULATION - REPLACE THIS
    // ========================================
    // TODO: Replace with real SAM2/CV tracking API call
    // Real implementation should:
    // 1. Extract frames from video (job.startFrame to job.stopFrame)
    // 2. Send to tracking API (SAM2, DINO, etc.) with initial bbox/points
    // 3. Receive per-frame results: { frame: number, found: boolean, bbox: {...}, confidence: number }[]
    // 4. Update annotations with actual tracked ranges
    
    simulateFakeTracking(jobId, job);
  };

  const simulateFakeTracking = (jobId: string, job: TrackingJob) => {
    // FAKE: Simulates progress with intervals
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? { ...j, progress } : j
        )
      );

      if (progress >= 100) {
        clearInterval(interval);
        
        // FAKE: Mark entire segment as tracked
        // REAL: Would use actual frame-by-frame results from tracking API
        const fakeTrackedRanges: [number, number][] = [
          [job.startFrame, job.stopFrame] // FAKE: assumes perfect tracking
        ];
        
        setTrackingJobs(jobs =>
          jobs.map(j =>
            j.id === jobId ? { ...j, status: "completed" as const } : j
          )
        );
        
        // Update annotations with tracked frames
        setAnnotations(prevAnnotations =>
          prevAnnotations.map(ann => {
            if (job.objectIds.includes(ann.id)) {
              const trackedFrames = ann.trackedFrames || [];
              return {
                ...ann,
                trackedFrames: [...trackedFrames, ...fakeTrackedRanges],
              };
            }
            return ann;
          })
        );
        
        toast({
          title: "Tracking completed (FAKE)",
          description: `Tracked ${job.objectIds.length} object(s) from frame ${job.startFrame} to ${job.stopFrame}`,
        });
      }
    }, 500);
  };
  // ========================================
  // END FAKE TRACKING SIMULATION
  // ========================================

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

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/detect-objects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          frameWidth: 1920,
          frameHeight: 1080,
        }),
      });

      const { detections } = await response.json();

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

  const handleAddKeyframe = (type: "START" | "STOP" | "SKIP") => {
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
                onToggleOverlay={handleToggleOverlay}
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
          onDeleteAnnotation={handleDeleteInstance}
          onDeleteKeyframe={handleDeleteKeyframe}
          onAddKeyframe={handleAddKeyframe}
          onStartTracking={handleStartTracking}
        />
      )}
    </div>
  );
};

export default Index;
