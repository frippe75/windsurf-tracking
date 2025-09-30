import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Flag, StopCircle, X as SkipIcon, Play } from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  context: {
    type: "annotation" | "keyframe" | "empty";
    id?: string;
    frame?: number;
    keyframeType?: "START" | "STOP" | "SKIP";
  };
  onDeleteAnnotation?: (id: string) => void;
  onDeleteKeyframe?: (frame: number) => void;
  onAddKeyframe?: (type: "START" | "STOP" | "SKIP") => void;
  onStartTracking?: (annotationId: string) => void;
}

export function ContextMenu({
  x,
  y,
  onClose,
  context,
  onDeleteAnnotation,
  onDeleteKeyframe,
  onAddKeyframe,
  onStartTracking,
}: ContextMenuProps) {
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    // Adjust position to keep menu in viewport
    const menuWidth = 200;
    const menuHeight = 150;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight);
    setPosition({ x: adjustedX, y: adjustedY });
  }, [x, y]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <Card
        className="fixed z-50 p-2 bg-card border-border min-w-[180px]"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
      >
        {context.type === "annotation" && context.id && (
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onStartTracking?.(context.id!);
                onClose();
              }}
            >
              <Play className="h-4 w-4 mr-2" />
              Start tracking
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                onDeleteAnnotation?.(context.id!);
                onClose();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        )}

        {context.type === "keyframe" && context.frame !== undefined && (
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                onDeleteKeyframe?.(context.frame!);
                onClose();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete keyframe
            </Button>
          </div>
        )}

        {context.type === "empty" && (
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onAddKeyframe?.("START");
                onClose();
              }}
            >
              <Flag className="h-4 w-4 mr-2" />
              Add START
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onAddKeyframe?.("STOP");
                onClose();
              }}
            >
              <StopCircle className="h-4 w-4 mr-2" />
              Add STOP
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onAddKeyframe?.("SKIP");
                onClose();
              }}
            >
              <SkipIcon className="h-4 w-4 mr-2" />
              Add SKIP
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
