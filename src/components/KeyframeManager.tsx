import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flag, StopCircle, X, Save, Download } from "lucide-react";

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

  // Group keyframes for display (group consecutive SKIP frames into ranges)
  const groupedKeyframes: Array<{
    type: "START" | "STOP" | "SKIP";
    frames: number[];
    displayText: string;
  }> = [];

  for (let i = 0; i < sortedKeyframes.length; i++) {
    const kf = sortedKeyframes[i];
    
    if (kf.type === "SKIP") {
      // Start a new SKIP group
      const skipFrames = [kf.frame];
      let j = i + 1;
      
      // Collect consecutive SKIP frames
      while (j < sortedKeyframes.length && 
             sortedKeyframes[j].type === "SKIP" && 
             sortedKeyframes[j].frame === skipFrames[skipFrames.length - 1] + 1) {
        skipFrames.push(sortedKeyframes[j].frame);
        j++;
      }
      
      // Create display text for ranges
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
      
      groupedKeyframes.push({
        type: "SKIP",
        frames: skipFrames,
        displayText: ranges.join(", "),
      });
      
      i = j - 1; // Skip processed frames
    } else {
      // START and STOP remain individual
      groupedKeyframes.push({
        type: kf.type,
        frames: [kf.frame],
        displayText: `${kf.frame}`,
      });
    }
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
                className="flex items-center gap-2 p-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getKeyframeColor(group.type) }}
                />
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-xs font-medium">{group.type}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.type === "SKIP" && group.frames.length > 1 
                      ? `Frames ${group.displayText}` 
                      : `Frame ${group.displayText}`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleDeleteGroup(group.frames)}
                  title={group.frames.length > 1 ? `Delete ${group.frames.length} keyframes` : `Delete keyframe`}
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
