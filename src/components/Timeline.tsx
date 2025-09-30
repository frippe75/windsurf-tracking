import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Flag } from "lucide-react";
import { useState } from "react";

interface Annotation {
  id: string;
  color: string;
  colorName: string;
  frameCreated: number;
}

interface Keyframe {
  frame: number;
  type: "START" | "STOP" | "SKIP";
}

interface TimelineProps {
  annotations: Annotation[];
  keyframes: Keyframe[];
  currentFrame: number;
  totalFrames: number;
  onFrameChange: (frame: number) => void;
}

export function Timeline({
  annotations,
  keyframes,
  currentFrame,
  totalFrames,
  onFrameChange,
}: TimelineProps) {
  const [expanded, setExpanded] = useState(true);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.round((x / rect.width) * totalFrames);
    onFrameChange(frame);
  };

  const getKeyframeColor = (type: string) => {
    switch (type) {
      case "START":
        return "hsl(var(--sail-green))";
      case "STOP":
        return "hsl(var(--destructive))";
      case "SKIP":
        return "hsl(var(--sail-yellow))";
      default:
        return "hsl(var(--muted-foreground))";
    }
  };

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-6 w-6 p-0"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          <h3 className="text-sm font-semibold">Timeline</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {annotations.length} objects • {keyframes.length} keyframes
        </span>
      </div>

      {expanded && (
        <div className="space-y-2">
          {/* Main timeline ruler */}
          <div className="relative h-8 bg-muted/30 rounded cursor-pointer" onClick={handleTimelineClick}>
            {/* Current frame indicator */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
              style={{ left: `${(currentFrame / totalFrames) * 100}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-primary rounded-full" />
            </div>

            {/* Keyframe markers */}
            {keyframes.map((kf) => (
              <div
                key={`${kf.frame}-${kf.type}`}
                className="absolute top-0 bottom-0 w-1 hover:w-2 transition-all"
                style={{
                  left: `${(kf.frame / totalFrames) * 100}%`,
                  backgroundColor: getKeyframeColor(kf.type),
                }}
                title={`${kf.type} at frame ${kf.frame}`}
              >
                <Flag className="absolute -top-1 left-0 h-3 w-3" style={{ color: getKeyframeColor(kf.type) }} />
              </div>
            ))}
          </div>

          {/* Annotations timeline */}
          {annotations.length > 0 && (
            <div className="space-y-1">
              {annotations.map((ann) => (
                <div key={ann.id} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ann.color }}
                  />
                  <div className="text-xs text-muted-foreground min-w-[60px]">{ann.colorName}</div>
                  <div className="flex-1 h-4 bg-muted/30 rounded relative">
                    {/* Show annotation presence from its creation frame onwards */}
                    <div
                      className="absolute top-0 bottom-0 rounded opacity-50"
                      style={{
                        left: `${(ann.frameCreated / totalFrames) * 100}%`,
                        right: 0,
                        backgroundColor: ann.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {annotations.length === 0 && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No annotations yet. Click on the video to add sails.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
