import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Flag } from "lucide-react";
import { useState } from "react";

interface Annotation {
  id: string;
  color: string;
  colorName: string;
  name?: string;
  frameCreated: number;
  trackedFrames?: Array<[number, number]>;
}

interface Keyframe {
  frame: number;
  type: "START" | "STOP" | "SKIP";
}

interface Scene {
  id: string;
  startFrame: number;
  endFrame: number;
  quality: string;
}

interface TimelineProps {
  annotations: Annotation[];
  keyframes: Keyframe[];
  currentFrame: number;
  totalFrames: number;
  frameRange: [number, number];
  onFrameChange: (frame: number) => void;
  selectedScene: Scene | null;
  onClearScene: () => void;
}

export function Timeline({
  annotations,
  keyframes,
  currentFrame,
  totalFrames,
  frameRange,
  onFrameChange,
  selectedScene,
  onClearScene,
}: TimelineProps) {
  const [expanded, setExpanded] = useState(true);
  const [startFrame, endFrame] = frameRange;
  const rangeSize = endFrame - startFrame;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const normalizedPosition = x / rect.width;
    const frame = Math.round(startFrame + normalizedPosition * rangeSize);
    onFrameChange(Math.max(startFrame, Math.min(endFrame, frame)));
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

  // Convert frame to visible timeline position (0-100%)
  const frameToPosition = (frame: number) => {
    if (frame < startFrame || frame > endFrame) return -1;
    return ((frame - startFrame) / rangeSize) * 100;
  };

  // Calculate tracking segments (START -> STOP pairs)
  const trackingSegments: Array<{ start: number; end: number }> = [];
  const sortedKeyframes = [...keyframes].sort((a, b) => a.frame - b.frame);
  
  for (let i = 0; i < sortedKeyframes.length; i++) {
    if (sortedKeyframes[i].type === "START") {
      // Find next STOP keyframe
      const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");
      if (stopKeyframe) {
        trackingSegments.push({
          start: sortedKeyframes[i].frame,
          end: stopKeyframe.frame,
        });
      }
    }
  }

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
          {selectedScene && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearScene}
              className="h-6 text-xs px-2"
            >
              Reset View
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {selectedScene 
            ? `Frames ${startFrame}-${endFrame}` 
            : `${annotations.length} objects • ${keyframes.length} keyframes`}
        </span>
      </div>

      {expanded && (
        <div className="space-y-2">
          {/* Main timeline ruler - aligned with annotation timelines */}
          <div className="flex items-center gap-2">
            {/* Spacer to align with annotation rows */}
            <div className="w-3 h-3 flex-shrink-0" />
            <div className="min-w-[60px]" />
            <div className="relative flex-1 h-8 bg-muted/30 rounded cursor-pointer" onClick={handleTimelineClick}>
            {/* Tracking segments background */}
            {trackingSegments.map((seg, idx) => {
              const startPos = frameToPosition(seg.start);
              const endPos = frameToPosition(seg.end);
              
              if (startPos < 0 && endPos < 0) return null;
              
              const displayStartPos = Math.max(0, startPos);
              const displayEndPos = Math.min(100, endPos);
              
              if (displayEndPos <= displayStartPos) return null;
              
              return (
                <div
                  key={`segment-${idx}`}
                  className="absolute top-0 bottom-0 bg-primary/20 border-l-2 border-r-2 border-primary/40"
                  style={{
                    left: `${displayStartPos}%`,
                    width: `${displayEndPos - displayStartPos}%`,
                  }}
                  title={`Tracking segment: ${seg.start} → ${seg.end}`}
                />
              );
            })}

            {/* Current frame indicator */}
            {currentFrame >= startFrame && currentFrame <= endFrame && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                style={{ left: `${frameToPosition(currentFrame)}%` }}
              >
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-primary rounded-full" />
              </div>
            )}

            {/* Keyframe markers */}
            {keyframes.map((kf, idx) => {
              const position = frameToPosition(kf.frame);
              if (position < 0) return null;
              
              return (
                <div
                  key={`${kf.frame}-${kf.type}-${idx}`}
                  className="absolute top-0 bottom-0 w-1 hover:w-2 transition-all"
                  style={{
                    left: `${position}%`,
                    backgroundColor: getKeyframeColor(kf.type),
                  }}
                  title={`${kf.type} at frame ${kf.frame}`}
                >
                  <Flag className="absolute -top-1 left-0 h-3 w-3" style={{ color: getKeyframeColor(kf.type) }} />
                </div>
              );
            })}
            </div>
          </div>

          {/* Annotations timeline */}
          {annotations.length > 0 && (
            <div className="space-y-1">
              {annotations.map((ann) => {
                const creationPos = frameToPosition(ann.frameCreated);
                
                return (
                  <div key={ann.id} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: ann.color }}
                    />
                    <div className="text-xs text-muted-foreground min-w-[60px]">{ann.name || ann.colorName}</div>
                    <div className="flex-1 h-4 bg-muted/30 rounded relative">
                      {/* Creation point marker (bright) */}
                      {creationPos >= 0 && creationPos <= 100 && (
                        <div
                          className="absolute top-0 bottom-0 w-1 rounded z-10"
                          style={{
                            left: `${creationPos}%`,
                            backgroundColor: ann.color,
                          }}
                          title={`Created at frame ${ann.frameCreated}`}
                        >
                          <div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                            style={{ backgroundColor: ann.color }}
                          />
                        </div>
                      )}
                      
                      {/* Tracked segments (solid bars) */}
                      {ann.trackedFrames?.map((range, idx) => {
                        const [rangeStart, rangeEnd] = range;
                        const trackStartPos = frameToPosition(rangeStart);
                        const trackEndPos = frameToPosition(rangeEnd);
                        
                        if (trackEndPos < 0 || trackStartPos > 100) return null;
                        
                        const displayStart = Math.max(0, trackStartPos);
                        const displayEnd = Math.min(100, trackEndPos);
                        
                        return (
                          <div
                            key={`${ann.id}-track-${idx}`}
                            className="absolute top-0 bottom-0 rounded"
                            style={{
                              left: `${displayStart}%`,
                              width: `${displayEnd - displayStart}%`,
                              backgroundColor: ann.color,
                              opacity: 0.6,
                            }}
                            title={`Tracked: frames ${rangeStart}-${rangeEnd}`}
                          />
                        );
                      })}
                      
                      {/* Untracked region indicator (very dim) - only if no tracked frames yet */}
                      {(!ann.trackedFrames || ann.trackedFrames.length === 0) && ann.frameCreated <= endFrame && (
                        <div
                          className="absolute top-0 bottom-0 rounded opacity-15"
                          style={{
                            left: `${Math.max(0, creationPos)}%`,
                            width: `${100 - Math.max(0, creationPos)}%`,
                            backgroundColor: ann.color,
                          }}
                          title="Untracked - needs tracking job"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
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
