import { useRef, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight } from "lucide-react";

interface VideoPlayerProps {
  videoUrl: string;
  currentFrame: number;
  totalFrames: number;
  onFrameChange: (frame: number) => void;
  onCanvasClick: (x: number, y: number) => void;
  annotations: Array<{
    id: string;
    color: string;
    points: Array<{ x: number; y: number }>;
    bbox?: { x: number; y: number; w: number; h: number };
  }>;
  overlays: {
    segments: boolean;
    bboxes: boolean;
    points: boolean;
  };
}

export function VideoPlayer({
  videoUrl,
  currentFrame,
  totalFrames,
  onFrameChange,
  onCanvasClick,
  annotations,
  overlays,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps] = useState(30); // Default FPS

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
      // Draw segment overlay
      if (overlays.segments && annotation.points.length > 0) {
        ctx.fillStyle = annotation.color + "40"; // 25% opacity
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

        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }

      // Draw center point
      if (overlays.points && annotation.points.length > 0) {
        const centerX = annotation.points.reduce((sum, p) => sum + p.x, 0) / annotation.points.length;
        const centerY = annotation.points.reduce((sum, p) => sum + p.y, 0) / annotation.points.length;
        const x = (centerX / 100) * canvas.width;
        const y = (centerY / 100) * canvas.height;

        ctx.fillStyle = annotation.color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onCanvasClick(x, y);
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
            if (videoRef.current) {
              const duration = videoRef.current.duration;
              // totalFrames would be duration * fps
            }
          }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onClick={handleCanvasClick}
        />
      </div>

      <div className="space-y-4">
        {/* Frame slider */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground min-w-[80px]">
            {currentFrame} / {totalFrames}
          </span>
          <Slider
            value={[currentFrame]}
            onValueChange={(value) => onFrameChange(value[0])}
            max={totalFrames}
            step={1}
            className="flex-1"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.max(0, currentFrame - 30))}
            title="Back 1 sec (Shift+Left)"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.max(0, currentFrame - 1))}
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
            onClick={() => onFrameChange(Math.min(totalFrames, currentFrame + 1))}
            title="Next frame (Right)"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onFrameChange(Math.min(totalFrames, currentFrame + 30))}
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
