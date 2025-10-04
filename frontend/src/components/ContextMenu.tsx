import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Flag, StopCircle, X as SkipIcon, Play, Eraser, Plus, Edit } from "lucide-react";

interface Keyframe {
  frame: number;
  type: "START" | "STOP" | "SKIP" | "META";
  timestamp: string;
  metadata?: Record<string, string>;
}

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  context: {
    type: "annotation" | "keyframe" | "empty" | "prompt";
    id?: string;
    frame?: number;
    keyframeType?: "START" | "STOP" | "SKIP" | "META";
    annotationId?: string;
    promptIndex?: number;
    promptType?: "positive" | "negative";
  };
  onDeleteAnnotation?: (id: string) => void;
  onDeleteKeyframe?: (frame: number) => void;
  onAddKeyframe?: (type: "START" | "STOP" | "SKIP") => void;
  onStartTracking?: (annotationId: string) => void;
  onDeletePrompt?: (annotationId: string, promptIndex: number) => void;
  onClearMetadata?: (frame: number) => void;
  onAddMetadata?: (frame: number) => void;
  keyframes?: Keyframe[];
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
  onDeletePrompt,
  onClearMetadata,
  onAddMetadata,
  keyframes = [],
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
            {context.keyframeType === "META" && (() => {
              const keyframe = keyframes.find(kf => kf.frame === context.frame && kf.type === "META");
              const hasMetadata = keyframe?.metadata && Object.keys(keyframe.metadata).length > 0;
              return (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      onAddMetadata?.(context.frame!);
                      onClose();
                    }}
                  >
                    {hasMetadata ? (
                      <>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit metadata
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Add metadata
                      </>
                    )}
                  </Button>
                  {hasMetadata && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        onClearMetadata?.(context.frame!);
                        onClose();
                      }}
                    >
                      <Eraser className="h-4 w-4 mr-2" />
                      Clear metadata
                    </Button>
                  )}
                </>
              );
            })()}
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

        {context.type === "prompt" && context.annotationId !== undefined && context.promptIndex !== undefined && (
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                onDeletePrompt?.(context.annotationId!, context.promptIndex!);
                onClose();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete {context.promptType === 'positive' ? '+ prompt' : '- prompt'}
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
