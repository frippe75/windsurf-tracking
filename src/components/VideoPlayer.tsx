import { useRef, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight } from "lucide-react";
import type { ToolMode } from "./Toolbox";

interface VideoPlayerProps {
  videoUrl: string;
  currentFrame: number;
  totalFrames: number;
  frameRange: [number, number];
  onFrameChange: (frame: number) => void;
  onVideoMetadata?: (metadata: { duration: number; totalFrames: number; fps: number }) => void;
  onCanvasClick: (x: number, y: number) => void;
  classes: Array<{ id: string; color: string }>;
  instances: Array<{ id: string; classId: string }>;
  annotations: Array<{
    id: string;
    instanceId: string;
    points: Array<{ x: number; y: number }>;
    bbox?: { x: number; y: number; w: number; h: number };
  }>;
  onAnnotationUpdate: (id: string, updates: { bbox?: { x: number; y: number; w: number; h: number }; points?: Array<{ x: number; y: number }> }) => void;
  overlays: {
    segments: boolean;
    bboxes: boolean;
    points: boolean;
  };
  selectedTool: ToolMode;
  selectedAnnotationId?: string;
  onContextMenu: (x: number, y: number, context: any) => void;
}

export function VideoPlayer({
  videoUrl,
  currentFrame,
  totalFrames,
  frameRange,
  onFrameChange,
  onVideoMetadata,
  onCanvasClick,
  classes,
  instances,
  annotations,
  onAnnotationUpdate,
  overlays,
  selectedTool,
  selectedAnnotationId,
  onContextMenu,
}: VideoPlayerProps) {
  // Helper to get color for an annotation
  const getAnnotationColor = (annotation: { instanceId: string }) => {
    const instance = instances.find(i => i.id === annotation.instanceId);
    if (!instance) return "#888888";
    const cls = classes.find(c => c.id === instance.classId);
    return cls?.color || "#888888";
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps] = useState(30); // Default FPS
  const [dragState, setDragState] = useState<{
    annotationId: string;
    handle: "move" | "nw" | "ne" | "sw" | "se" | null;
    startX: number;
    startY: number;
    originalBbox: { x: number; y: number; w: number; h: number };
  } | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      const time = currentFrame / fps;
      videoRef.current.currentTime = time;
    }
  }, [currentFrame, fps]);

  useEffect(() => {
    drawAnnotations();
  }, [annotations, overlays, currentFrame]);

  const drawAnnotations = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    annotations.forEach((annotation) => {
      const isSelected = selectedAnnotationId === annotation.id;
      const color = getAnnotationColor(annotation);
      
      // Draw segment overlay
      if (overlays.segments && annotation.points.length > 0) {
        ctx.fillStyle = color + "40"; // 25% opacity
        ctx.beginPath();
        annotation.points.forEach((point, i) => {
          const x = (point.x / 100) * canvas.width;
          const y = (point.y / 100) * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
      }

      // Draw bounding box
      if (overlays.bboxes && annotation.bbox) {
        const bbox = annotation.bbox;
        const x = (bbox.x / 100) * canvas.width;
        const y = (bbox.y / 100) * canvas.height;
        const w = (bbox.w / 100) * canvas.width;
        const h = (bbox.h / 100) * canvas.height;

        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(x, y, w, h);

        // Draw resize handles if selected and in edit mode
        if (isSelected && selectedTool === "edit") {
          const handleSize = 8;
          ctx.fillStyle = color;
          
          // Corner handles
          [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
            ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
          });
        }
      }

      // Draw center point
      if (overlays.points && annotation.points.length > 0) {
        const centerX = annotation.points.reduce((sum, p) => sum + p.x, 0) / annotation.points.length;
        const centerY = annotation.points.reduce((sum, p) => sum + p.y, 0) / annotation.points.length;
        const x = (centerX / 100) * canvas.width;
        const y = (centerY / 100) * canvas.height;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  const getResizeHandle = (x: number, y: number, bbox: { x: number; y: number; w: number; h: number }) => {
    const threshold = 2; // percentage units
    const { x: bx, y: by, w: bw, h: bh } = bbox;
    
    if (Math.abs(x - bx) < threshold && Math.abs(y - by) < threshold) return "nw";
    if (Math.abs(x - (bx + bw)) < threshold && Math.abs(y - by) < threshold) return "ne";
    if (Math.abs(x - bx) < threshold && Math.abs(y - (by + bh)) < threshold) return "sw";
    if (Math.abs(x - (bx + bw)) < threshold && Math.abs(y - (by + bh)) < threshold) return "se";
    
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Edit mode: check for resize handles
    if (selectedTool === "edit" && selectedAnnotationId) {
      const annotation = annotations.find(a => a.id === selectedAnnotationId);
      if (annotation?.bbox) {
        const handle = getResizeHandle(x, y, annotation.bbox);
        if (handle) {
          setDragState({
            annotationId: selectedAnnotationId,
            handle,
            startX: x,
            startY: y,
            originalBbox: { ...annotation.bbox },
          });
          return;
        }
        
        // Check if clicking inside bbox for move
        const { x: bx, y: by, w: bw, h: bh } = annotation.bbox;
        if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
          setDragState({
            annotationId: selectedAnnotationId,
            handle: "move",
            startX: x,
            startY: y,
            originalBbox: { ...annotation.bbox },
          });
          return;
        }
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragState) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const dx = x - dragState.startX;
    const dy = y - dragState.startY;
    const { originalBbox, handle } = dragState;

    let newBbox = { ...originalBbox };

    if (handle === "move") {
      newBbox.x = originalBbox.x + dx;
      newBbox.y = originalBbox.y + dy;
    } else if (handle === "nw") {
      newBbox.x = originalBbox.x + dx;
      newBbox.y = originalBbox.y + dy;
      newBbox.w = originalBbox.w - dx;
      newBbox.h = originalBbox.h - dy;
    } else if (handle === "ne") {
      newBbox.y = originalBbox.y + dy;
      newBbox.w = originalBbox.w + dx;
      newBbox.h = originalBbox.h - dy;
    } else if (handle === "sw") {
      newBbox.x = originalBbox.x + dx;
      newBbox.w = originalBbox.w - dx;
      newBbox.h = originalBbox.h + dy;
    } else if (handle === "se") {
      newBbox.w = originalBbox.w + dx;
      newBbox.h = originalBbox.h + dy;
    }

    // Ensure minimum size
    if (newBbox.w < 2 || newBbox.h < 2) return;

    onAnnotationUpdate(dragState.annotationId, { bbox: newBbox });
  };

  const handleCanvasMouseUp = () => {
    setDragState(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedTool !== "annotate") return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onCanvasClick(x, y);
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Check if click is on an annotation
    const clickedAnnotation = annotations.find(ann => {
      if (!ann.bbox) return false;
      const { x: bx, y: by, w: bw, h: bh } = ann.bbox;
      return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
    });

    onContextMenu(e.clientX, e.clientY, {
      type: clickedAnnotation ? "annotation" : "empty",
      id: clickedAnnotation?.id,
    });
  };

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <Card className="p-4 bg-card border-border">
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          onLoadedMetadata={() => {
            if (videoRef.current && onVideoMetadata) {
              const duration = videoRef.current.duration;
              const calculatedFrames = Math.floor(duration * fps);
              onVideoMetadata({
                duration,
                totalFrames: calculatedFrames,
                fps,
              });
            }
          }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: selectedTool === "edit" && selectedAnnotationId ? "move" : "crosshair" }}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onContextMenu={handleCanvasContextMenu}
        />
      </div>

      <div className="space-y-4">
        {/* Frame slider */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground min-w-[100px]">
            {currentFrame} / {frameRange[1]}
          </span>
          <Slider
            value={[currentFrame]}
            onValueChange={(value) => onFrameChange(value[0])}
            min={frameRange[0]}
            max={frameRange[1]}
            step={1}
            className="flex-1"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.max(frameRange[0], currentFrame - 30))}
            title="Back 1 sec (Shift+Left)"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.max(frameRange[0], currentFrame - 1))}
            title="Previous frame (Left)"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={togglePlayPause}
            title="Play/Pause (Space)"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.min(frameRange[1], currentFrame + 1))}
            title="Next frame (Right)"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.min(frameRange[1], currentFrame + 30))}
            title="Forward 1 sec (Shift+Right)"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center">
          Space: Play/Pause • Arrows: Frame • Shift+Arrows: 1 sec • Click video to annotate
        </div>
      </div>
    </Card>
  );
}
