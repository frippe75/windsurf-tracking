import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trash2, Circle } from "lucide-react";

interface Annotation {
  id: string;
  color: string;
  colorName: string;
  points: Array<{ x: number; y: number }>;
  bbox?: { x: number; y: number; w: number; h: number };
  frameCreated: number;
}

interface AnnotationControlsProps {
  annotations: Annotation[];
  currentFrame: number;
  overlays: {
    segments: boolean;
    bboxes: boolean;
    points: boolean;
  };
  onToggleOverlay: (key: "segments" | "bboxes" | "points") => void;
  onDeleteAnnotation: (id: string) => void;
  onSelectAnnotation: (id: string) => void;
  selectedAnnotationId?: string;
}

export function AnnotationControls({
  annotations,
  currentFrame,
  overlays,
  onToggleOverlay,
  onDeleteAnnotation,
  onSelectAnnotation,
  selectedAnnotationId,
}: AnnotationControlsProps) {
  return (
    <Card className="p-4 bg-card border-border space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-3">Overlays</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="segments" className="text-sm">
              Segments
            </Label>
            <Switch
              id="segments"
              checked={overlays.segments}
              onCheckedChange={() => onToggleOverlay("segments")}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="bboxes" className="text-sm">
              Bounding Boxes
            </Label>
            <Switch
              id="bboxes"
              checked={overlays.bboxes}
              onCheckedChange={() => onToggleOverlay("bboxes")}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="points" className="text-sm">
              Center Points
            </Label>
            <Switch
              id="points"
              checked={overlays.points}
              onCheckedChange={() => onToggleOverlay("points")}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Annotations</h3>
          <Badge variant="secondary">{annotations.length}</Badge>
        </div>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {annotations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Click on the video to create annotations
            </p>
          ) : (
            annotations.map((annotation) => (
              <div
                key={annotation.id}
                className={`flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer ${
                  selectedAnnotationId === annotation.id
                    ? "bg-accent border-accent"
                    : "bg-secondary border-transparent hover:border-border"
                }`}
                onClick={() => onSelectAnnotation(annotation.id)}
              >
                <Circle
                  className="h-4 w-4 flex-shrink-0"
                  style={{ color: annotation.color }}
                  fill={annotation.color}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{annotation.colorName}</div>
                  <div className="text-xs text-muted-foreground">
                    Frame {annotation.frameCreated}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAnnotation(annotation.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold mb-2">Quick Tips</h3>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>• Click video to add annotation point</div>
          <div>• 1-5: Toggle overlay visibility</div>
          <div>• S: Mark START keyframe</div>
          <div>• E: Mark STOP keyframe</div>
          <div>• X: Mark SKIP keyframe</div>
        </div>
      </div>
    </Card>
  );
}
