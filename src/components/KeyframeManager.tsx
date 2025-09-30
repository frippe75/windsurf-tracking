import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flag, StopCircle, X, Save, Download, Trash2 } from "lucide-react";

interface Keyframe {
  frame: number;
  type: "START" | "STOP" | "SKIP";
  timestamp: string;
}

interface KeyframeManagerProps {
  keyframes: Keyframe[];
  currentFrame: number;
  onAddKeyframe: (type: "START" | "STOP" | "SKIP") => void;
  onDeleteKeyframe: (frame: number) => void;
  onSaveProject: () => void;
  onExportData: () => void;
}

export function KeyframeManager({
  keyframes,
  currentFrame,
  onAddKeyframe,
  onDeleteKeyframe,
  onSaveProject,
  onExportData,
}: KeyframeManagerProps) {
  const sortedKeyframes = [...keyframes].sort((a, b) => a.frame - b.frame);

  const getKeyframeColor = (type: string) => {
    switch (type) {
      case "START":
        return "hsl(var(--success))";
      case "STOP":
        return "hsl(var(--destructive))";
      case "SKIP":
        return "hsl(var(--warning))";
      default:
        return "hsl(var(--muted))";
    }
  };

  // Group keyframes for display (group SKIP frames between START/STOP pairs)
  const groupedKeyframes: Array<{
    type: "START" | "STOP" | "SKIP";
    frames: number[];
    displayText: string;
    ranges?: Array<{ text: string; frames: number[] }>; // For SKIP pills
  }> = [];

  // Helper to convert range text to frames
  const rangeToFrames = (rangeText: string): number[] => {
    if (rangeText.includes('-')) {
      const [start, end] = rangeText.split('-').map(Number);
      const frames: number[] = [];
      for (let i = start; i <= end; i++) {
        frames.push(i);
      }
      return frames;
    }
    return [Number(rangeText)];
  };

  let i = 0;
  while (i < sortedKeyframes.length) {
    const kf = sortedKeyframes[i];
    
    if (kf.type === "START") {
      // Add START keyframe
      groupedKeyframes.push({
        type: "START",
        frames: [kf.frame],
        displayText: `${kf.frame}`,
      });
      
      // Find the corresponding STOP keyframe
      let stopIndex = -1;
      for (let j = i + 1; j < sortedKeyframes.length; j++) {
        if (sortedKeyframes[j].type === "STOP") {
          stopIndex = j;
          break;
        }
      }
      
      // Collect all SKIP frames between START and STOP
      const skipFrames: number[] = [];
      for (let j = i + 1; j < (stopIndex >= 0 ? stopIndex : sortedKeyframes.length); j++) {
        if (sortedKeyframes[j].type === "SKIP") {
          skipFrames.push(sortedKeyframes[j].frame);
        }
      }
      
      // Add grouped SKIP frames if any
      if (skipFrames.length > 0) {
        const ranges: string[] = [];
        let rangeStart = skipFrames[0];
        let rangeEnd = skipFrames[0];
        
        for (let k = 1; k < skipFrames.length; k++) {
          if (skipFrames[k] === rangeEnd + 1) {
            rangeEnd = skipFrames[k];
          } else {
            ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
            rangeStart = skipFrames[k];
            rangeEnd = skipFrames[k];
          }
        }
        ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
        
        // Create ranges array with frame mapping
        const rangesWithFrames = ranges.map(rangeText => ({
          text: rangeText,
          frames: rangeToFrames(rangeText),
        }));
        
        groupedKeyframes.push({
          type: "SKIP",
          frames: skipFrames,
          displayText: ranges.join(", "),
          ranges: rangesWithFrames,
        });
      }
      
      // Add STOP keyframe if found
      if (stopIndex >= 0) {
        groupedKeyframes.push({
          type: "STOP",
          frames: [sortedKeyframes[stopIndex].frame],
          displayText: `${sortedKeyframes[stopIndex].frame}`,
        });
        i = stopIndex + 1;
      } else {
        i++;
      }
    } else if (kf.type === "STOP") {
      // Orphan STOP (no preceding START)
      groupedKeyframes.push({
        type: "STOP",
        frames: [kf.frame],
        displayText: `${kf.frame}`,
      });
      i++;
    } else {
      // Orphan SKIP (outside START/STOP pairs) - skip for now, will be added at end
      i++;
    }
  }
  
  // Collect any orphan SKIP frames (outside all START/STOP pairs)
  const orphanSkips: number[] = [];
  let lastStopFrame = -1;
  
  for (let i = sortedKeyframes.length - 1; i >= 0; i--) {
    if (sortedKeyframes[i].type === "STOP") {
      lastStopFrame = sortedKeyframes[i].frame;
      break;
    }
  }
  
  sortedKeyframes.forEach(kf => {
    if (kf.type === "SKIP" && (lastStopFrame < 0 || kf.frame > lastStopFrame)) {
      orphanSkips.push(kf.frame);
    }
  });
  
  if (orphanSkips.length > 0) {
    const ranges: string[] = [];
    let rangeStart = orphanSkips[0];
    let rangeEnd = orphanSkips[0];
    
    for (let k = 1; k < orphanSkips.length; k++) {
      if (orphanSkips[k] === rangeEnd + 1) {
        rangeEnd = orphanSkips[k];
      } else {
        ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
        rangeStart = orphanSkips[k];
        rangeEnd = orphanSkips[k];
      }
    }
    ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
    
    // Create ranges array with frame mapping
    const rangesWithFrames = ranges.map(rangeText => ({
      text: rangeText,
      frames: rangeToFrames(rangeText),
    }));
    
    groupedKeyframes.push({
      type: "SKIP",
      frames: orphanSkips,
      displayText: ranges.join(", "),
      ranges: rangesWithFrames,
    });
  }

  const handleDeleteGroup = (frames: number[]) => {
    frames.forEach(frame => onDeleteKeyframe(frame));
  };

  return (
    <Card className="p-4 bg-card border-border space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Keyframe Manager</h3>
        <Badge variant="secondary">{keyframes.length}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          onClick={() => onAddKeyframe("START")}
          className="w-full"
          variant="outline"
          size="sm"
        >
          <Flag className="h-4 w-4 mr-1" />
          START (S)
        </Button>
        <Button
          onClick={() => onAddKeyframe("STOP")}
          className="w-full"
          variant="outline"
          size="sm"
        >
          <StopCircle className="h-4 w-4 mr-1" />
          STOP (E)
        </Button>
        <Button
          onClick={() => onAddKeyframe("SKIP")}
          className="w-full"
          variant="outline"
          size="sm"
        >
          <X className="h-4 w-4 mr-1" />
          SKIP (X)
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Keyframes</h4>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {sortedKeyframes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No keyframes added yet
            </p>
          ) : (
            groupedKeyframes.map((group, idx) => (
              <div
                key={`${group.type}-${idx}`}
                className="flex items-start gap-2 p-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                  style={{ backgroundColor: getKeyframeColor(group.type) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{group.type}</span>
                    {group.type !== "SKIP" && (
                      <span className="text-xs text-muted-foreground">Frame {group.displayText}</span>
                    )}
                  </div>
                  
                  {/* SKIP ranges as pills */}
                  {group.type === "SKIP" && group.ranges && (
                    <div className="flex flex-wrap gap-1">
                      {group.ranges.map((range, rangeIdx) => (
                        <div
                          key={rangeIdx}
                          className="group h-5 pl-2 pr-1 text-[10px] font-medium rounded-full border flex items-center gap-1 text-foreground"
                          style={{ backgroundColor: 'hsl(var(--sail-yellow))', borderColor: 'hsl(var(--sail-yellow))' }}
                        >
                          <span>{range.text}</span>
                          <button
                            onClick={() => handleDeleteGroup(range.frames)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                            title={`Delete frames ${range.text}`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Delete button for all types */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleDeleteGroup(group.frames)}
                  title={group.type === "SKIP" ? `Delete all ${group.frames.length} skip frames` : "Delete keyframe"}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-2">
        <Button onClick={onSaveProject} className="w-full" variant="default">
          <Save className="h-4 w-4 mr-2" />
          Save Project (Ctrl+S)
        </Button>
        <Button onClick={onExportData} className="w-full" variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Export Annotations
        </Button>
      </div>
    </Card>
  );
}
