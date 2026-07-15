import { useRef, useEffect, useState } from "react";
import { deriveFps } from "@/lib/fps";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import type { ToolMode } from "./Toolbox";

interface VideoPlayerProps {
  videoUrl: string;
  currentFrame: number;
  totalFrames: number;
  frameRange: [number, number];
  onFrameChange: (frame: number) => void;
  onVideoMetadata?: (metadata: { duration: number; totalFrames: number; fps: number }) => void;
  onCanvasClick: (x: number, y: number, videoWidth: number, videoHeight: number, ctrlKey: boolean, altKey: boolean) => void;
  classes: Array<{ id: string; color: string; name: string }>;
  instances: Array<{ id: string; classId: string; instanceNumber: number }>;
  annotations: Array<{
    id: string;
    instanceId: string;
    points: Array<{ x: number; y: number }>;
    bbox?: { x: number; y: number; w: number; h: number };
    sam2Prompts?: Array<{ x: number; y: number; type: 'positive' | 'negative' }>;
    frameCreated: number;
    trackedFrames?: Array<[number, number]>;
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
  // Touch tap tracking (mobile has no mouse click on the canvas)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchHandledRef = useRef(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoDims, setVideoDims] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [isPlaying, setIsPlaying] = useState(false);
  // Real fps, derived from the backend frame count and the video's duration on
  // load. A hardcoded 30 mis-seeks every non-30fps video (frame N shows at
  // N/30s while the backend indexes frame N at N/realFps) → SAM2 masks a
  // DIFFERENT frame than the one on screen. Falls back to 30 until known.
  const [fps, setFps] = useState(30);
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
  const [showZoomOverlay, setShowZoomOverlay] = useState(false);
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showResetButton, setShowResetButton] = useState(false);
  const resetButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      const time = currentFrame / fps;
      videoRef.current.currentTime = time;
    }
  }, [currentFrame, fps]);

  // Force video reload when videoUrl changes (for video switching)
  useEffect(() => {
    if (videoRef.current && videoUrl) {
      console.log('🔄 VideoPlayer: Reloading video with new URL:', videoUrl);
      videoRef.current.load();
      videoRef.current.currentTime = 0;
    }
  }, [videoUrl]);

  useEffect(() => {
    drawAnnotations();
    // containerSize/videoDims MUST be deps: the canvas bitmap is sized from the
    // displayed rect inside drawAnnotations. Without them, the first draw runs
    // while the container is 0×0 (canvas clamps to 1×1) and never re-sizes when
    // the ResizeObserver reports the real size — leaving a 1×1 canvas that maps
    // every click/tap to the corner. (Was broken on mobile.)
  }, [annotations, overlays, currentFrame, zoom, pan, selectedAnnotationId, selectedTool, showLabels, containerSize, videoDims]);

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

  // Auto-hide reset button after 3 seconds when at 100% zoom
  useEffect(() => {
    // Clear any existing timeout
    if (resetButtonTimeoutRef.current) {
      clearTimeout(resetButtonTimeoutRef.current);
    }
    
    if (zoom === 1 && pan.x === 0 && pan.y === 0) {
      // At 100% zoom - fade out after 3 seconds
      resetButtonTimeoutRef.current = setTimeout(() => {
        setShowResetButton(false);
      }, 3000);
    } else {
      // Zoomed or panned - show button immediately
      setShowResetButton(true);
    }

    return () => {
      if (resetButtonTimeoutRef.current) {
        clearTimeout(resetButtonTimeoutRef.current);
      }
    };
  }, [zoom, pan.x, pan.y]);

  const drawAnnotations = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI crisp rendering sized to displayed rect and current zoom
    const dpr = window.devicePixelRatio || 1;
    const displayed = getDisplayedRect();
    // Internal bitmap accounts for zoom and DPR so CSS scaling stays sharp
    canvas.width = Math.max(1, Math.round(displayed.width * dpr * zoom));
    canvas.height = Math.max(1, Math.round(displayed.height * dpr * zoom));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Base scale in internal pixels that corresponds to un-zoomed CSS pixels
    const baseX = canvas.width / zoom; // = displayed.width * dpr
    const baseY = canvas.height / zoom; // = displayed.height * dpr
    const invZoom = 1 / zoom;

    // Filter annotations to only show those visible on current frame
    const visibleAnnotations = annotations.filter((annotation) => {
      // Check if annotation is tracked to this frame
      if (annotation.trackedFrames) {
        const isInTrackedRange = annotation.trackedFrames.some(
          ([start, end]) => currentFrame >= start && currentFrame <= end
        );
        if (isInTrackedRange) return true;
      }
      // Otherwise, only show on the frame where it was created
      return currentFrame === annotation.frameCreated;
    });
    
    console.log(`📍 Frame ${currentFrame}: ${visibleAnnotations.length} visible annotations, selected=${selectedAnnotationId}`);
    visibleAnnotations.forEach(ann => {
      console.log(`  - ${ann.id} (frame ${ann.frameCreated}, keyframe=${(ann as any).isKeyframe}, hasBbox=${!!ann.bbox})`);
    });

    visibleAnnotations.forEach((annotation) => {
      // Check if this annotation OR any annotation from the same instance is selected
      const isSelected = selectedAnnotationId === annotation.id || 
        (selectedAnnotationId && annotations.find(a => a.id === selectedAnnotationId)?.instanceId === annotation.instanceId);
      const color = getAnnotationColor(annotation);
      
      // Draw segment overlay (mask if available, else polygon)
      if (overlays.segments) {
        // Prefer high-fidelity mask overlay if available
        if ((annotation as any).maskBase64 && (annotation as any).maskBBox) {
          const { maskBase64, maskBBox, maskIsCropped } = annotation as any;
          const img = new Image();
          img.src = `data:image/png;base64,${maskBase64}`;
          img.onload = () => {
            // Create a temporary canvas to colorize the mask
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) return;
            
            // Scale mask bbox using canvas dimensions (accounts for DPR and zoom)
            const x = maskIsCropped ? (maskBBox.x / 100) * canvas.width : 0;
            const y = maskIsCropped ? (maskBBox.y / 100) * canvas.height : 0;
            const w = maskIsCropped ? (maskBBox.w / 100) * canvas.width : canvas.width;
            const h = maskIsCropped ? (maskBBox.h / 100) * canvas.height : canvas.height;
            
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            
            // Draw the mask
            tempCtx.drawImage(img, 0, 0);
            
            // Get image data to colorize it
            const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
            const data = imageData.data;
            
            // Parse the color (assuming it's in hsl format like "hsl(142, 71%, 45%)")
            const colorMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
            let r = 255, g = 255, b = 255;
            if (colorMatch) {
              const h = parseInt(colorMatch[1]) / 360;
              const s = parseInt(colorMatch[2]) / 100;
              const l = parseInt(colorMatch[3]) / 100;
              // Simple HSL to RGB conversion
              const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
              };
              const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
              const p = 2 * l - q;
              r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
              g = Math.round(hue2rgb(p, q, h) * 255);
              b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
            }
            
            // Colorize: replace white pixels with class color, keep alpha from mask
            for (let i = 0; i < data.length; i += 4) {
              const brightness = data[i]; // grayscale mask, so R=G=B
              if (brightness > 128) { // If pixel is bright (part of mask)
                data[i] = r;     // Red
                data[i + 1] = g; // Green
                data[i + 2] = b; // Blue
                data[i + 3] = 150; // Semi-transparent
              } else {
                data[i + 3] = 0; // Fully transparent for black areas
              }
            }
            
            tempCtx.putImageData(imageData, 0, 0);
            
            // Draw colorized mask on main canvas
            ctx.save();
            ctx.drawImage(tempCanvas, 0, 0, img.width, img.height, x, y, w, h);
            ctx.restore();
          };
        } else if (annotation.points.length > 0) {
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
      }

      // Draw bounding box
      if (overlays.bboxes && annotation.bbox) {
        const bbox = annotation.bbox;
        const x = (bbox.x / 100) * canvas.width;
        const y = (bbox.y / 100) * canvas.height;
        const w = (bbox.w / 100) * canvas.width;
        const h = (bbox.h / 100) * canvas.height;

        ctx.strokeStyle = color;
        ctx.lineWidth = (isSelected ? 3 : 2) * dpr;
        ctx.strokeRect(x, y, w, h);

        // Draw label above bbox (scaled inversely to zoom for fixed size)
        if (showLabels) {
          const instance = instances.find(i => i.id === annotation.instanceId);
          const cls = classes.find(c => c.id === instance?.classId);
          if (instance && cls) {
            const label = `${cls.name}#${instance.instanceNumber}`;
            
            // Fixed screen size using device pixel ratio (20% smaller)
            const fontSize = 17.28 * dpr;
            const padding = 8.64 * dpr;
            const labelHeight = 25.92 * dpr;
            
            ctx.font = `bold ${fontSize}px sans-serif`;
            const metrics = ctx.measureText(label);
            const labelWidth = metrics.width + padding * 2;
            
            // Draw background above bbox (bottom of label = top of bbox)
            ctx.fillStyle = color;
            ctx.fillRect(x, y - labelHeight, labelWidth, labelHeight);
            
            // Draw text
            ctx.fillStyle = "white";
            ctx.textBaseline = "middle";
            ctx.fillText(label, x + padding, y - labelHeight / 2);
          }
        }

        // Draw resize handles if selected and in edit mode (scaled inversely to zoom)
        if (isSelected && selectedTool === "edit") {
          const handleSize = 12.8 * dpr;
          
          // Corner handles with white fill and black border
          [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
            // White fill
            ctx.fillStyle = "white";
            ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
            // Black border
            ctx.strokeStyle = "black";
            ctx.lineWidth = 2 * dpr;
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
        ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw SAM2 prompts (positive/negative point markers)
      if (annotation.sam2Prompts && annotation.sam2Prompts.length > 0) {
        annotation.sam2Prompts.forEach(prompt => {
          const x = (prompt.x / 100) * canvas.width;
          const y = (prompt.y / 100) * canvas.height;
          const radius = 8 * dpr;
          
          // Draw circle
          ctx.strokeStyle = prompt.type === 'positive' ? '#00ff00' : '#ff3333';
          ctx.lineWidth = 2 * dpr;
          ctx.fillStyle = prompt.type === 'positive' ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 51, 51, 0.5)';
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          
          // Draw +/- sign
          ctx.strokeStyle = prompt.type === 'positive' ? '#00ff00' : '#ff3333';
          ctx.lineWidth = 2 * dpr;
          const signSize = 4 * dpr;
          
          // Horizontal line for both
          ctx.beginPath();
          ctx.moveTo(x - signSize, y);
          ctx.lineTo(x + signSize, y);
          ctx.stroke();
          
          // Vertical line only for positive
          if (prompt.type === 'positive') {
            ctx.beginPath();
            ctx.moveTo(x, y - signSize);
            ctx.lineTo(x, y + signSize);
            ctx.stroke();
          }
        });
      }
    });
    
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

    // Show zoom overlay and reset fade timer
    setShowZoomOverlay(true);
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }
    zoomTimeoutRef.current = setTimeout(() => {
      setShowZoomOverlay(false);
    }, 5000);
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
      // First check if we're interacting with the currently selected instance's annotation
      if (selectedAnnotationId) {
        const selectedAnnotation = annotations.find(a => a.id === selectedAnnotationId);
        if (selectedAnnotation) {
          // Find the visible annotation for this instance on the current frame
          const visibleAnnotation = annotations.find(a => 
            a.instanceId === selectedAnnotation.instanceId && 
            (a.frameCreated === currentFrame || 
             a.trackedFrames?.some(([start, end]) => currentFrame >= start && currentFrame <= end))
          );
          
          if (visibleAnnotation?.bbox) {
            const handle = getResizeHandle(x, y, visibleAnnotation.bbox);
            if (handle) {
              setDragState({
                annotationId: visibleAnnotation.id,
                handle,
                startX: x,
                startY: y,
                originalBbox: { ...visibleAnnotation.bbox },
              });
              return;
            }
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

      const selectedAnnotation = annotations.find(a => a.id === selectedAnnotationId);
      if (selectedAnnotation) {
        // Find the visible annotation for this instance on the current frame
        const visibleAnnotation = annotations.find(a => 
          a.instanceId === selectedAnnotation.instanceId && 
          (a.frameCreated === currentFrame || 
           a.trackedFrames?.some(([start, end]) => currentFrame >= start && currentFrame <= end))
        );
        
        if (visibleAnnotation?.bbox) {
          const handle = getResizeHandle(x, y, visibleAnnotation.bbox);
          if (handle === "nw" || handle === "se") {
            setCursorStyle("nwse-resize");
            return;
          } else if (handle === "ne" || handle === "sw") {
            setCursorStyle("nesw-resize");
            return;
          }
          
          const { x: bx, y: by, w: bw, h: bh } = visibleAnnotation.bbox;
          if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
            setCursorStyle("move");
            return;
          }
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

  // Shared placement: convert screen coords → video-frame % and dispatch.
  const placePromptAt = (clientX: number, clientY: number, ctrlKey: boolean, altKey: boolean) => {
    if (selectedTool !== "annotate") return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = canvas.getBoundingClientRect();
    const { x: canvasX, y: canvasY } = screenToCanvas(clientX, clientY, rect);
    const displayed = getDisplayedRect();
    const dpr = window.devicePixelRatio || 1;
    const displayedX = canvasX / (dpr * zoom);
    const displayedY = canvasY / (dpr * zoom);
    const x = (displayedX / displayed.width) * 100;
    const y = (displayedY / displayed.height) * 100;
    onCanvasClick(x, y, displayed.width, displayed.height, ctrlKey, altKey);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Touch taps are handled by onPointerUp; skip the synthesized mouse click
    // so we don't place the prompt twice.
    if (touchHandledRef.current) {
      touchHandledRef.current = false;
      return;
    }
    const isAltLike = e.altKey || e.getModifierState?.('AltGraph') === true;
    placePromptAt(e.clientX, e.clientY, e.ctrlKey || e.metaKey, isAltLike);
  };

  // Touch: pointer events fire reliably on the canvas where a synthesized
  // mouse click may not. Treat a pointerup close to its pointerdown as a tap.
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "touch") return;
    touchStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "touch") return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved > 12) return; // a drag/pan, not a tap
    touchHandledRef.current = true; // swallow the following synthesized click
    // No keyboard on touch → let Index's tap-mode toggle decide the prompt type.
    placePromptAt(e.clientX, e.clientY, false, false);
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY, rect);
    const x = (canvasX / canvas.width) * 100;
    const y = (canvasY / canvas.height) * 100;

    // First check if clicking on a SAM2 prompt (priority over annotation or empty)
    for (const annotation of annotations) {
      if (annotation.sam2Prompts) {
        for (let i = 0; i < annotation.sam2Prompts.length; i++) {
          const prompt = annotation.sam2Prompts[i];
          const dx = Math.abs(x - prompt.x);
          const dy = Math.abs(y - prompt.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // 1.5% threshold for clicking on prompt (larger than visual radius for easier clicking)
          if (distance < 1.5) {
            onContextMenu(e.clientX, e.clientY, {
              type: "prompt",
              annotationId: annotation.id,
              promptIndex: i,
              promptType: prompt.type,
            });
            return;
          }
        }
      }
    }

    // Check if click is on an annotation
    const clickedAnnotation = annotations.find(ann => {
      if (!ann.bbox) return false;
      const { x: bx, y: by, w: bw, h: bh } = ann.bbox;
      return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
    });

    onContextMenu(e.clientX, e.clientY, {
      type: clickedAnnotation ? "annotation" : "empty",
      id: clickedAnnotation?.instanceId,
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
              const duration = videoRef.current.duration;
              // Derive the real fps from the known frame count (backend) and
              // the actual duration. This is what makes scrubbing land on the
              // same frame the backend extracts for SAM2.
              const realFps = deriveFps(totalFrames, duration, fps);
              if (realFps > 0 && Number.isFinite(realFps)) {
                setFps(realFps);
              }
              // Report metadata to parent
              if (onVideoMetadata) {
                onVideoMetadata({
                  duration,
                  totalFrames: totalFrames > 0 ? totalFrames : Math.floor(duration * realFps),
                  fps: realFps,
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
            pointerEvents: "auto",
            touchAction: "none",
          }}
          onClick={handleCanvasClick}
          onPointerDown={handleCanvasPointerDown}
          onPointerUp={handleCanvasPointerUp}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onContextMenu={handleCanvasContextMenu}
          onWheel={handleCanvasWheel}
        />
        
        {/* Zoom percentage overlay - bottom left */}
        {showZoomOverlay && (
          <div className="absolute bottom-4 left-4 bg-black/80 text-white px-3 py-1.5 rounded text-sm font-medium pointer-events-none transition-opacity duration-300">
            {Math.round(zoom * 100)}%
          </div>
        )}
        
        {/* Reset view button - top right */}
        <Button
          variant="outline"
          size="icon"
          className={`absolute top-4 right-4 bg-black/50 border-white/20 hover:bg-black/70 transition-opacity duration-1000 ${
            showResetButton ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            setShowZoomOverlay(false);
            setShowResetButton(false);
            if (zoomTimeoutRef.current) {
              clearTimeout(zoomTimeoutRef.current);
            }
            if (resetButtonTimeoutRef.current) {
              clearTimeout(resetButtonTimeoutRef.current);
            }
          }}
        >
          <Maximize2 className="h-4 w-4 text-white" />
        </Button>
        
      </div>

      <div className="space-y-4">
        {/* Frame slider */}
        <div className="flex items-center gap-2">
          {/* Spacers to align with timeline columns below */}
          <div className="h-5 w-5 flex-shrink-0" />
          <div className="w-3 h-3 flex-shrink-0" />
          <div className="min-w-[80px] text-sm text-muted-foreground">
            {currentFrame} / {frameRange[1]}
          </div>
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
      </div>
    </Card>
  );
}
