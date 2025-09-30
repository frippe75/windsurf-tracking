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
  onCanvasClick: (x: number, y: number, videoWidth: number, videoHeight: number) => void;
  classes: Array<{ id: string; color: string; name: string }>;
  instances: Array<{ id: string; classId: string; instanceNumber: number }>;
  annotations: Array<{
    id: string;
    instanceId: string;
    points: Array<{ x: number; y: number }>;
    bbox?: { x: number; y: number; w: number; h: number };
  }>;
  onAnnotationUpdate: (id: string, updates: { bbox?: { x: number; y: number; w: number; h: number }; points?: Array<{ x: number; y: number }> }) => void;
  onAnnotationSelect?: (id: string | undefined) => void;
  overlays: {
    segments: boolean;
    bboxes: boolean;
    points: boolean;
  };
  selectedTool: ToolMode;
  selectedAnnotationId?: string;
  onContextMenu: (x: number, y: number, context: any) => void;
  showLabels?: boolean;
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
  onAnnotationSelect,
  overlays,
  selectedTool,
  selectedAnnotationId,
  onContextMenu,
  showLabels = true,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoDims, setVideoDims] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps] = useState(30); // Default FPS
  const [zoom, setZoom] = useState(1); // Zoom level (1 = 100%)
  const [pan, setPan] = useState({ x: 0, y: 0 }); // Pan offset in pixels
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [cursorStyle, setCursorStyle] = useState<string>("crosshair");
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
  }, [annotations, overlays, currentFrame, zoom, pan, selectedAnnotationId, selectedTool, showLabels]);

  // Track container size so we can align canvas to the video's rendered box (object-contain)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    // CSS transform is applied on the canvas element itself; no context transform needed
    ctx.save();

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

        // Draw label above bbox
        if (showLabels) {
          const instance = instances.find(i => i.id === annotation.instanceId);
          const cls = classes.find(c => c.id === instance?.classId);
          if (instance && cls) {
            const label = `${cls.name}#${instance.instanceNumber}`;
            
            // Measure text for background
            ctx.font = "14px sans-serif";
            const metrics = ctx.measureText(label);
            const padding = 6;
            const labelWidth = metrics.width + padding * 2;
            const labelHeight = 20;
            
            // Draw background (slightly above bbox)
            ctx.fillStyle = color;
            ctx.fillRect(x, y - labelHeight - 4, labelWidth, labelHeight);
            
            // Draw text
            ctx.fillStyle = "white";
            ctx.textBaseline = "middle";
            ctx.fillText(label, x + padding, y - labelHeight / 2 - 4);
          }
        }

        // Draw resize handles if selected and in edit mode
        if (isSelected && selectedTool === "edit") {
          const handleSize = 12;
          
          // Corner handles with white fill and black border
          [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
            // White fill
            ctx.fillStyle = "white";
            ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
            // Black border
            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;
            ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
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
    
    // Restore canvas state after zoom/pan
    ctx.restore();
  };

  const getResizeHandle = (x: number, y: number, bbox: { x: number; y: number; w: number; h: number }) => {
    const threshold = 4; // percentage units - larger threshold for easier grabbing
    const { x: bx, y: by, w: bw, h: bh } = bbox;
    
    if (Math.abs(x - bx) < threshold && Math.abs(y - by) < threshold) return "nw";
    if (Math.abs(x - (bx + bw)) < threshold && Math.abs(y - by) < threshold) return "ne";
    if (Math.abs(x - bx) < threshold && Math.abs(y - (by + bh)) < threshold) return "sw";
    if (Math.abs(x - (bx + bw)) < threshold && Math.abs(y - (by + bh)) < threshold) return "se";
    
    return null;
  };

  const isNearBboxEdge = (x: number, y: number, bbox: { x: number; y: number; w: number; h: number }) => {
    const edgeThreshold = 3; // percentage units for edge detection
    const { x: bx, y: by, w: bw, h: bh } = bbox;
    
    // Check if near any edge
    const nearLeft = Math.abs(x - bx) < edgeThreshold && y >= by - edgeThreshold && y <= by + bh + edgeThreshold;
    const nearRight = Math.abs(x - (bx + bw)) < edgeThreshold && y >= by - edgeThreshold && y <= by + bh + edgeThreshold;
    const nearTop = Math.abs(y - by) < edgeThreshold && x >= bx - edgeThreshold && x <= bx + bw + edgeThreshold;
    const nearBottom = Math.abs(y - (by + bh)) < edgeThreshold && x >= bx - edgeThreshold && x <= bx + bw + edgeThreshold;
    
    return nearLeft || nearRight || nearTop || nearBottom;
  };

  // Transform screen coordinates to canvas coordinates accounting for zoom, pan and CSS scaling
  const screenToCanvas = (screenX: number, screenY: number, rect: DOMRect) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    // Map CSS pixels (post-transform) to canvas internal pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (screenX - rect.left) * scaleX;
    const y = (screenY - rect.top) * scaleY;
    return { x, y };
  };
  // Compute the displayed video rectangle within the container (object-contain)
  const getDisplayedRect = () => {
    const cw = containerSize.width;
    const ch = containerSize.height;
    const vw = videoDims.width;
    const vh = videoDims.height;
    if (!cw || !ch || !vw || !vh) return { width: 0, height: 0, left: 0, top: 0, scale: 1 };

    const s = Math.min(cw / vw, ch / vh);
    const width = vw * s;
    const height = vh * s;
    const left = (cw - width) / 2;
    const top = (ch - height) / 2;
    return { width, height, left, top, scale: s };
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const displayed = getDisplayedRect();
    
    // Mouse position relative to untransformed canvas top-left
    const mouseX = e.clientX - containerRect.left - displayed.left;
    const mouseY = e.clientY - containerRect.top - displayed.top;

    // Zoom in/out with mouse wheel
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(1, zoom * zoomDelta), 3);

    // Adjust pan to zoom towards mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - (mouseX - pan.x) * scale,
      y: mouseY - (mouseY - pan.y) * scale,
    });
    setZoom(newZoom);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    
    // Middle mouse button or space+left click for panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY, rect);
    const x = (canvasX / canvas.width) * 100;
    const y = (canvasY / canvas.height) * 100;

    // Edit mode: check for resize handles or selection
    if (selectedTool === "edit") {
      // First check if we're interacting with the currently selected annotation's handles
      if (selectedAnnotationId) {
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
        }
      }
      
      // Check if clicking on/near any annotation to select it
      // Priority: exact click inside > near edge > any overlap
      let clickedAnnotation = annotations.find(ann => {
        if (!ann.bbox) return false;
        const { x: bx, y: by, w: bw, h: bh } = ann.bbox;
        // Check if clicking inside bbox
        return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      });
      
      // If not inside any bbox, check if near edges
      if (!clickedAnnotation) {
        clickedAnnotation = annotations.find(ann => {
          if (!ann.bbox) return false;
          return isNearBboxEdge(x, y, ann.bbox);
        });
      }
      
      if (clickedAnnotation) {
        onAnnotationSelect?.(clickedAnnotation.id);
        
        // If clicking inside the selected bbox, allow moving
        if (clickedAnnotation.bbox) {
          const { x: bx, y: by, w: bw, h: bh } = clickedAnnotation.bbox;
          if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
            setDragState({
              annotationId: clickedAnnotation.id,
              handle: "move",
              startX: x,
              startY: y,
              originalBbox: { ...clickedAnnotation.bbox },
            });
          }
        }
      } else {
        // Clicking on empty space deselects
        onAnnotationSelect?.(undefined);
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle panning
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    // Update cursor based on hover state
    if (selectedTool === "edit" && selectedAnnotationId && !dragState) {
      const rect = canvas.getBoundingClientRect();
      const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY, rect);
      const x = (canvasX / canvas.width) * 100;
      const y = (canvasY / canvas.height) * 100;

      const annotation = annotations.find(a => a.id === selectedAnnotationId);
      if (annotation?.bbox) {
        const handle = getResizeHandle(x, y, annotation.bbox);
        if (handle === "nw" || handle === "se") {
          setCursorStyle("nwse-resize");
          return;
        } else if (handle === "ne" || handle === "sw") {
          setCursorStyle("nesw-resize");
          return;
        }
        
        const { x: bx, y: by, w: bw, h: bh } = annotation.bbox;
        if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
          setCursorStyle("move");
          return;
        }
      }
    }
    
    setCursorStyle(selectedTool === "edit" ? "default" : "crosshair");

    if (!dragState) return;

    const rect = canvas.getBoundingClientRect();
    const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY, rect);
    const x = (canvasX / canvas.width) * 100;
    const y = (canvasY / canvas.height) * 100;

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
    setIsPanning(false);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedTool !== "annotate") return;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = canvas.getBoundingClientRect();
    const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY, rect);
    const x = (canvasX / canvas.width) * 100;
    const y = (canvasY / canvas.height) * 100;
    const videoWidth = video.videoWidth || 1280;
    const videoHeight = video.videoHeight || 720;
    onCanvasClick(x, y, videoWidth, videoHeight);
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY, rect);
    const x = (canvasX / canvas.width) * 100;
    const y = (canvasY / canvas.height) * 100;

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

  const displayed = getDisplayedRect();
  return (
    <Card className="p-4 bg-card border-border">
      <div ref={containerRef} className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'top left',
          }}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              // Report metadata to parent
              if (onVideoMetadata) {
                const duration = videoRef.current.duration;
                const calculatedFrames = Math.floor(duration * fps);
                onVideoMetadata({
                  duration,
                  totalFrames: calculatedFrames,
                  fps,
                });
              }
              // Track intrinsic video dimensions for object-contain math
              setVideoDims({
                width: videoRef.current.videoWidth || 1280,
                height: videoRef.current.videoHeight || 720,
              });
            }
          }}
        />
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{
            left: displayed.left,
            top: displayed.top,
            width: displayed.width,
            height: displayed.height,
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'top left',
            cursor: isPanning ? "grabbing" : cursorStyle,
          }}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onContextMenu={handleCanvasContextMenu}
          onWheel={handleCanvasWheel}
        />
      </div>

      <div className="space-y-4">
        {/* Zoom controls */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="min-w-[100px]">
            Zoom: {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          >
            Reset View
          </Button>
          <span className="text-xs">
            (Scroll to zoom, Shift+Drag to pan)
          </span>
        </div>

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
          Space: Play/Pause • Arrows: Frame • Shift+Arrows: 1 sec • M: Edit mode • Tab/Shift+Tab: Cycle annotations
        </div>
      </div>
    </Card>
  );
}
