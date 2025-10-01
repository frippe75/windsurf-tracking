import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Flag, Trash2, Plus, Edit, Eraser } from "lucide-react";
import { useState } from "react";
import { Class, Instance, Annotation, Keyframe, Scene } from "@/types/annotation";
import {
  ContextMenu as ContextMenuPrimitive,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export interface TrackingJob {
  id: string;
  startFrame: number;
  stopFrame: number;
  objectIds: string[];
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
}

interface HierarchicalTimelineProps {
  classes: Class[];
  instances: Instance[];
  annotations: Annotation[];
  keyframes: Keyframe[];
  currentFrame: number;
  totalFrames: number;
  frameRange: [number, number];
  onFrameChange: (frame: number) => void;
  selectedScene: Scene | null;
  onClearScene: () => void;
  trackingJobs: TrackingJob[];
  onDeleteKeyframe: (frame: number) => void;
  onAddMetadata?: (frame: number) => void;
  onClearMetadata?: (frame: number) => void;
  scenes?: Scene[];
}

export function HierarchicalTimeline({
  classes,
  instances,
  annotations,
  keyframes,
  currentFrame,
  totalFrames,
  frameRange,
  onFrameChange,
  selectedScene,
  onClearScene,
  trackingJobs,
  onDeleteKeyframe,
  onAddMetadata,
  onClearMetadata,
  scenes = [],
}: HierarchicalTimelineProps) {
  const [expanded, setExpanded] = useState(true);
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [startFrame, endFrame] = frameRange;
  const rangeSize = endFrame - startFrame;

  const toggleClassExpanded = (classId: string) => {
    const newExpanded = new Set(expandedClasses);
    if (newExpanded.has(classId)) {
      newExpanded.delete(classId);
    } else {
      newExpanded.add(classId);
    }
    setExpandedClasses(newExpanded);
  };

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
        return "hsl(var(--sail-purple))";
      case "META":
        return "hsl(var(--chart-5))";
      default:
        return "hsl(var(--muted-foreground))";
    }
  };

  const frameToPosition = (frame: number) => {
    if (frame < startFrame || frame > endFrame) return -1;
    return ((frame - startFrame) / rangeSize) * 100;
  };

  // Calculate tracking segments (START -> STOP pairs)
  const trackingSegments: Array<{ start: number; end: number }> = [];
  const sortedKeyframes = [...keyframes].sort((a, b) => a.frame - b.frame);
  
  for (let i = 0; i < sortedKeyframes.length; i++) {
    if (sortedKeyframes[i].type === "START") {
      const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");
      if (stopKeyframe) {
        trackingSegments.push({
          start: sortedKeyframes[i].frame,
          end: stopKeyframe.frame,
        });
      }
    }
  }

  // Calculate skip segments (consecutive SKIP keyframes)
  const skipSegments: Array<{ start: number; end: number }> = [];
  const skipKeyframes = sortedKeyframes.filter(kf => kf.type === "SKIP");
  
  let currentSkipStart = -1;
  let currentSkipEnd = -1;
  
  for (let i = 0; i < skipKeyframes.length; i++) {
    const frame = skipKeyframes[i].frame;
    
    if (currentSkipStart === -1) {
      currentSkipStart = frame;
      currentSkipEnd = frame;
    } else if (frame === currentSkipEnd + 1) {
      currentSkipEnd = frame;
    } else {
      skipSegments.push({ start: currentSkipStart, end: currentSkipEnd });
      currentSkipStart = frame;
      currentSkipEnd = frame;
    }
  }
  
  if (currentSkipStart !== -1) {
    skipSegments.push({ start: currentSkipStart, end: currentSkipEnd });
  }

  const getInstancesForClass = (classId: string) => {
    return instances.filter(inst => inst.classId === classId);
  };

  const getAnnotationsForInstance = (instanceId: string) => {
    return annotations.filter(ann => ann.instanceId === instanceId);
  };

  // Get all annotations for a class (aggregated across instances)
  const getClassAnnotationRanges = (classId: string) => {
    const classInstances = getInstancesForClass(classId);
    const ranges: Array<[number, number]> = [];
    
    classInstances.forEach(instance => {
      const instanceAnnotations = getAnnotationsForInstance(instance.id);
      instanceAnnotations.forEach(ann => {
        if (ann.trackedFrames && ann.trackedFrames.length > 0) {
          ranges.push(...ann.trackedFrames);
        } else {
          // Just the creation point
          ranges.push([ann.frameCreated, ann.frameCreated]);
        }
      });
    });
    
    return ranges;
  };

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center gap-2 mb-3">
        {/* Column 1: Toggle button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="h-6 w-6 p-0 flex-shrink-0"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        
        {/* Column 2: Spacer for dot indicator */}
        <div className="w-3 h-3 flex-shrink-0" />
        
        {/* Column 3: Title and metadata in label space */}
        <div className="min-w-[80px] flex items-center gap-2 flex-shrink-0">
          <h3 className="text-sm font-semibold">Timeline</h3>
        </div>
        
        {/* Column 4: Main timeline ruler */}
        <div className="relative flex-1 h-8 bg-muted/30 rounded cursor-pointer" onClick={handleTimelineClick}>
          {/* Tracking segments background */}
          {trackingSegments.map((seg, idx) => {
            const startPos = frameToPosition(seg.start);
            const endPos = frameToPosition(seg.end);
            
            if (startPos < 0 && endPos < 0) return null;
            
            const displayStartPos = Math.max(0, startPos);
            const displayEndPos = Math.min(100, endPos);
            
            if (displayEndPos <= displayStartPos) return null;
            
            // Find the corresponding tracking job for this segment
            const job = trackingJobs.find(
              j => j.startFrame === seg.start && j.stopFrame === seg.end
            );
            
            return (
              <div
                key={`segment-${idx}`}
                className="absolute top-0 bottom-0 bg-primary/20 border-l-2 border-r-2 border-primary/40 overflow-hidden"
                style={{
                  left: `${displayStartPos}%`,
                  width: `${displayEndPos - displayStartPos}%`,
                }}
                title={`Tracking segment: ${seg.start} → ${seg.end}${job ? ` (${job.status}${job.progress ? `: ${job.progress}%` : ''})` : ''}`}
              >
                {/* Progress bar for processing and completed jobs */}
                {job && (job.status === "processing" || job.status === "completed") && (
                  <div
                    className="absolute bottom-0 left-0 h-[3px] bg-primary transition-all"
                    style={{ width: job.status === "completed" ? "100%" : `${job.progress || 0}%` }}
                  />
                )}
              </div>
            );
          })}

          {/* Skip segments background */}
          {skipSegments.map((seg, idx) => {
            const startPos = frameToPosition(seg.start);
            const endPos = frameToPosition(seg.end);
            
            if (startPos < 0 && endPos < 0) return null;
            
            const displayStartPos = Math.max(0, startPos);
            const displayEndPos = Math.min(100, endPos);
            
            if (displayEndPos <= displayStartPos) return null;
            
              return (
                <div
                  key={`skip-segment-${idx}`}
                  className="absolute top-0 bottom-0 bg-[hsl(var(--sail-purple))]/20 border-l-2 border-r-2 border-[hsl(var(--sail-purple))]/40"
                  style={{
                    left: `${displayStartPos}%`,
                    width: `${displayEndPos - displayStartPos}%`,
                  }}
                  title={`Skip segment: ${seg.start} → ${seg.end}`}
                />
              );
          })}

          {/* Scene boundary markers - above timeline bg, below keyframe markers */}
          {scenes.map((scene) => {
            const boundaryPos = frameToPosition(scene.endFrame);
            if (boundaryPos < 0 || boundaryPos > 100) return null;
            
            return (
              <div
                key={`scene-boundary-${scene.id}`}
                className="absolute top-0 w-[1px] bg-border/50 z-0"
                style={{ 
                  left: `${boundaryPos}%`,
                  height: 'calc(100% + 24px)'
                }}
                title={`Scene boundary at frame ${scene.endFrame}`}
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
            
            const markerContent = (
              <div
                key={`${kf.frame}-${kf.type}-${idx}`}
                className="absolute top-0 bottom-0 w-1 hover:w-2 transition-all"
                style={{
                  left: `${position}%`,
                  backgroundColor: getKeyframeColor(kf.type),
                }}
                title={`${kf.type} at frame ${kf.frame}`}
              >
                {kf.type === "META" && (
                  (!kf.metadata || Object.values(kf.metadata).every(v => String(v ?? '').trim().length === 0)) ? (
                    <Flag className="absolute -top-1 left-0 h-3 w-3" style={{ color: getKeyframeColor(kf.type) }} />
                  ) : (
                    <Flag
                      className="absolute -top-1 left-0 h-3 w-3"
                      style={{ color: "hsl(var(--muted-foreground))", fill: "hsl(var(--muted-foreground))" }}
                      strokeWidth={2}
                    />
                  )
                )}
              </div>
            );

            // Wrap META keyframes in context menu
            if (kf.type === "META") {
              return (
                <ContextMenuPrimitive key={`${kf.frame}-${kf.type}-${idx}`}>
                  <ContextMenuTrigger asChild>
                    {markerContent}
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => onAddMetadata?.(kf.frame)}
                    >
                      {kf.metadata && Object.keys(kf.metadata).length > 0 ? (
                        <>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit metadata
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Add metadata
                        </>
                      )}
                    </ContextMenuItem>
                    {kf.metadata && Object.keys(kf.metadata).length > 0 && (
                      <ContextMenuItem
                        onClick={() => onClearMetadata?.(kf.frame)}
                      >
                        <Eraser className="mr-2 h-4 w-4" />
                        Clear metadata
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem
                      onClick={() => onDeleteKeyframe(kf.frame)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete META keyframe
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenuPrimitive>
              );
            }

            return markerContent;
          })}
          
          {/* Info text overlaid on bottom border */}
          <span className="absolute -bottom-2 right-2 text-[10px] text-muted-foreground bg-background px-1 z-20">
            {selectedScene 
              ? `Frames ${startFrame}-${endFrame}` 
              : `${classes.length} classes • ${instances.length} instances`}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2">

          {/* Classes and Instances timeline */}
          {classes.length > 0 && (
            <div className="space-y-1">
              {classes.map((cls) => {
                const classInstances = getInstancesForClass(cls.id);
                const isExpanded = expandedClasses.has(cls.id);
                const classRanges = getClassAnnotationRanges(cls.id);

                return (
                  <div key={cls.id} className="space-y-0.5">
                    {/* Class-level track */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleClassExpanded(cls.id)}
                        className="h-5 w-5 p-0 flex-shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cls.color }}
                      />
                      <div className="text-xs font-medium text-muted-foreground min-w-[80px]">
                        {cls.name}
                      </div>
                      <div className="flex-1 h-4 bg-muted/30 rounded relative">
                        {/* Aggregated class presence */}
                        {classRanges.map((range, idx) => {
                          const [rangeStart, rangeEnd] = range;
                          const trackStartPos = frameToPosition(rangeStart);
                          const trackEndPos = frameToPosition(rangeEnd);
                          
                          if (trackEndPos < 0 || trackStartPos > 100) return null;
                          
                          const displayStart = Math.max(0, trackStartPos);
                          const displayEnd = Math.max(displayStart, Math.min(100, trackEndPos));
                          
                          return (
                            <div
                              key={`${cls.id}-range-${idx}`}
                              className="absolute top-0 bottom-0 rounded"
                              style={{
                                left: `${displayStart}%`,
                                width: `${Math.max(1, displayEnd - displayStart)}%`,
                                backgroundColor: cls.color,
                                opacity: 0.4,
                              }}
                              title={`${cls.name} present: frames ${rangeStart}-${rangeEnd}`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Instance-level tracks (when expanded) */}
                    {isExpanded && (
                      <div className="space-y-0.5">
                        {classInstances.map((instance) => {
                          const instanceAnnotations = getAnnotationsForInstance(instance.id);
                          const displayName = instance.name || `${cls.name}#${instance.instanceNumber}`;

                          return (
                            <div key={instance.id} className="flex items-center gap-2">
                              <div className="h-5 w-5 flex-shrink-0" />
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: cls.color }}
                              />
                              <div className="text-xs text-muted-foreground min-w-[80px]">
                                {displayName}
                              </div>
                              <div className="flex-1 h-3 bg-muted/20 rounded relative">
                                {instanceAnnotations.map((ann, annIdx) => {
                                  const creationPos = frameToPosition(ann.frameCreated);
                                  
                                  return (
                                    <div key={`${ann.id}-${annIdx}`}>
                                      {/* Creation point */}
                                      {creationPos >= 0 && creationPos <= 100 && (
                                        <div
                                          className="absolute top-0 bottom-0 w-1 rounded z-10"
                                          style={{
                                            left: `${creationPos}%`,
                                            backgroundColor: cls.color,
                                          }}
                                          title={`Created at frame ${ann.frameCreated}`}
                                        >
                                          <div
                                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                                            style={{ backgroundColor: cls.color }}
                                          />
                                        </div>
                                      )}
                                      
                                      {/* Tracked segments */}
                                      {ann.trackedFrames?.map((range, rangeIdx) => {
                                        const [rangeStart, rangeEnd] = range;
                                        const trackStartPos = frameToPosition(rangeStart);
                                        const trackEndPos = frameToPosition(rangeEnd);
                                        
                                        if (trackEndPos < 0 || trackStartPos > 100) return null;
                                        
                                        const displayStart = Math.max(0, trackStartPos);
                                        const displayEnd = Math.min(100, trackEndPos);
                                        
                                        return (
                                          <div
                                            key={`${ann.id}-track-${rangeIdx}`}
                                            className="absolute top-0 bottom-0 rounded"
                                            style={{
                                              left: `${displayStart}%`,
                                              width: `${displayEnd - displayStart}%`,
                                              backgroundColor: cls.color,
                                              opacity: 0.7,
                                            }}
                                            title={`Tracked: frames ${rangeStart}-${rangeEnd}`}
                                          />
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {classes.length === 0 && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No classes yet. Create a class to start annotating.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
