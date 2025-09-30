import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MousePointer, Target, Edit3 } from "lucide-react";

export type ToolMode = "select" | "annotate" | "edit";

interface ToolboxProps {
  selectedTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
  autoTrack: boolean;
  onAutoTrackChange: (enabled: boolean) => void;
  autoDetect: boolean;
  onAutoDetectChange: (enabled: boolean) => void;
  useSAM2: boolean;
  onUseSAM2Change: (enabled: boolean) => void;
}

export function Toolbox({
  selectedTool,
  onToolChange,
  autoTrack,
  onAutoTrackChange,
  autoDetect,
  onAutoDetectChange,
  useSAM2,
  onUseSAM2Change,
}: ToolboxProps) {
  return (
    <Card className="p-3 bg-card border-border">
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold mb-2 text-muted-foreground">Tools</h3>
          <div className="grid grid-cols-3 gap-1">
            <Button
              variant={selectedTool === "select" ? "default" : "outline"}
              size="sm"
              onClick={() => onToolChange("select")}
              className="flex flex-col gap-1 h-auto py-2"
            >
              <MousePointer className="h-4 w-4" />
              <span className="text-xs">Select</span>
            </Button>
            <Button
              variant={selectedTool === "annotate" ? "default" : "outline"}
              size="sm"
              onClick={() => onToolChange("annotate")}
              className="flex flex-col gap-1 h-auto py-2"
            >
              <Target className="h-4 w-4" />
              <span className="text-xs">Annotate</span>
            </Button>
            <Button
              variant={selectedTool === "edit" ? "default" : "outline"}
              size="sm"
              onClick={() => onToolChange("edit")}
              className="flex flex-col gap-1 h-auto py-2"
            >
              <Edit3 className="h-4 w-4" />
              <span className="text-xs">Edit</span>
            </Button>
          </div>
        </div>

        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="use-sam2" className="text-xs cursor-pointer">
              Use SAM2 on click
            </Label>
            <Switch
              id="use-sam2"
              checked={useSAM2}
              onCheckedChange={onUseSAM2Change}
              className="scale-75"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-detect" className="text-xs cursor-pointer">
              Auto-detect (DINO)
            </Label>
            <Switch
              id="auto-detect"
              checked={autoDetect}
              onCheckedChange={onAutoDetectChange}
              className="scale-75"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-track" className="text-xs cursor-pointer">
              Auto-track new objects
            </Label>
            <Switch
              id="auto-track"
              checked={autoTrack}
              onCheckedChange={onAutoTrackChange}
              className="scale-75"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
