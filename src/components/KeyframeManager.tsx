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
            sortedKeyframes.map((keyframe) => (
              <div
                key={keyframe.frame}
                className="flex items-center gap-2 p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getKeyframeColor(keyframe.type) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{keyframe.type}</div>
                  <div className="text-xs text-muted-foreground">
                    Frame {keyframe.frame}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => onDeleteKeyframe(keyframe.frame)}
                >
                  <X className="h-4 w-4" />
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
