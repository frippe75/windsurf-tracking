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

  // Group keyframes for display (collect all SKIP frames into one group)
  const groupedKeyframes: Array<{
    type: "START" | "STOP" | "SKIP";
    frames: number[];
    displayText: string;
  }> = [];

  // Separate SKIP frames from others
  const skipFrames = sortedKeyframes.filter(kf => kf.type === "SKIP").map(kf => kf.frame);
  const nonSkipKeyframes = sortedKeyframes.filter(kf => kf.type !== "SKIP");

  // Add all non-SKIP keyframes individually
  nonSkipKeyframes.forEach(kf => {
    groupedKeyframes.push({
      type: kf.type,
      frames: [kf.frame],
      displayText: `${kf.frame}`,
    });
  });

  // Group all SKIP frames into one item with ranges
  if (skipFrames.length > 0) {
    const ranges: string[] = [];
    let rangeStart = skipFrames[0];
    let rangeEnd = skipFrames[0];
    
    for (let i = 1; i < skipFrames.length; i++) {
      if (skipFrames[i] === rangeEnd + 1) {
        rangeEnd = skipFrames[i];
      } else {
        ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
        rangeStart = skipFrames[i];
        rangeEnd = skipFrames[i];
      }
    }
    ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
    
    groupedKeyframes.push({
      type: "SKIP",
      frames: skipFrames,
      displayText: ranges.join(", "),
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
