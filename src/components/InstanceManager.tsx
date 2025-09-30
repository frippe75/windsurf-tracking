import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Check, X, Tags } from "lucide-react";
import { useState } from "react";
import { Class, Instance, Annotation } from "@/types/annotation";
import { MetadataEditor } from "./MetadataEditor";

interface InstanceManagerProps {
  classData: Class;
  instances: Instance[];
  annotations: Annotation[];
  currentFrame: number;
  onRenameInstance: (instanceId: string, newName: string) => void;
  onDeleteInstance: (instanceId: string) => void;
  onUpdateMetadata: (instanceId: string, metadata: Record<string, string>) => void;
}

export function InstanceManager({
  classData,
  instances,
  annotations,
  currentFrame,
  onRenameInstance,
  onDeleteInstance,
  onUpdateMetadata,
}: InstanceManagerProps) {
  const [editingInstanceId, setEditingInstanceId] = useState<string>();
  const [editValue, setEditValue] = useState("");
  const [editingMetadataId, setEditingMetadataId] = useState<string>();

  const startEditing = (instance: Instance) => {
    setEditingInstanceId(instance.id);
    setEditValue(instance.name || `${classData.name}#${instance.instanceNumber}`);
  };

  const cancelEditing = () => {
    setEditingInstanceId(undefined);
    setEditValue("");
  };

  const saveEdit = (instanceId: string) => {
    if (editValue.trim()) {
      onRenameInstance(instanceId, editValue.trim());
    }
    cancelEditing();
  };

  const getAnnotationsForInstance = (instanceId: string) => {
    return annotations.filter(ann => ann.instanceId === instanceId);
  };

  const getInstanceFrameRange = (instanceId: string) => {
    const instanceAnnotations = getAnnotationsForInstance(instanceId);
    if (instanceAnnotations.length === 0) return null;

    let minFrame = Infinity;
    let maxFrame = -Infinity;

    instanceAnnotations.forEach(ann => {
      minFrame = Math.min(minFrame, ann.frameCreated);
      ann.trackedFrames?.forEach(([start, end]) => {
        maxFrame = Math.max(maxFrame, end);
      });
    });

    return maxFrame > minFrame ? `Frames ${minFrame}-${maxFrame}` : `Frame ${minFrame}`;
  };

  return (
    <div className="space-y-1">
      {instances.map((instance) => {
        const instanceAnnotations = getAnnotationsForInstance(instance.id);
        const frameRange = getInstanceFrameRange(instance.id);
        const displayName = instance.name || `${classData.name}#${instance.instanceNumber}`;
        const hasMetadata = Object.keys(instance.metadata).length > 0;

        return (
          <div key={instance.id} className="space-y-1">
            <div className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/30 transition-colors">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: classData.color }}
              />
              <div className="flex-1 min-w-0">
                {editingInstanceId === instance.id ? (
                  <div className="flex items-center gap-1 mb-0.5">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(instance.id);
                        if (e.key === "Escape") cancelEditing();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-auto py-0 px-0 text-xs font-medium border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveEdit(instance.id);
                      }}
                      className="h-4 w-4 p-0"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelEditing();
                      }}
                      className="h-4 w-4 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="text-xs font-medium cursor-pointer hover:underline transition-all mb-0.5"
                    onClick={() => startEditing(instance)}
                    title="Click to rename"
                  >
                    {displayName}
                  </div>
                )}
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{frameRange || "No annotations"}</span>
                  {hasMetadata && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Tags className="h-2.5 w-2.5" />
                      {Object.keys(instance.metadata).length}
                    </span>
                  )}
                </div>
              </div>
              {editingInstanceId !== instance.id && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingMetadataId(instance.id)}
                    className="h-5 w-5 p-0"
                    title="Edit metadata"
                  >
                    <Tags className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteInstance(instance.id)}
                    className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {/* Metadata editor */}
            {editingMetadataId === instance.id && (
              <MetadataEditor
                metadata={instance.metadata}
                onSave={(metadata) => {
                  onUpdateMetadata(instance.id, metadata);
                  setEditingMetadataId(undefined);
                }}
                onCancel={() => setEditingMetadataId(undefined)}
              />
            )}
          </div>
        );
      })}

      {instances.length === 0 && (
        <div className="text-center py-2 text-xs text-muted-foreground">
          No instances yet. Click on video to create.
        </div>
      )}
    </div>
  );
}
