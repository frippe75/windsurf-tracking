import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Check, X, ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { useState } from "react";
import { Class, Instance, Annotation } from "@/types/annotation";
import { SAIL_COLORS } from "@/lib/annotationOps";
import { InstanceManager } from "./InstanceManager";

interface ClassManagerProps {
  classes: Class[];
  instances: Instance[];
  annotations: Annotation[];
  currentFrame: number;
  overlays: {
    segments: boolean;
    bboxes: boolean;
    points: boolean;
  };
  selectedClassId?: string;
  showLabels: boolean;
  onToggleOverlay: (key: "segments" | "bboxes" | "points") => void;
  onShowLabelsChange: (enabled: boolean) => void;
  onSelectClass: (classId: string) => void;
  onCreateClass: (name: string) => void;
  onRenameClass: (classId: string, newName: string) => void;
  onUpdateClassPrompt: (classId: string, prompt: string) => void;
  onUpdateClassColor: (classId: string, hex: string, colorName?: string) => void;
  onDeleteClass: (classId: string) => void;
  onRenameInstance: (instanceId: string, newName: string) => void;
  onDeleteInstance: (instanceId: string) => void;
  onUpdateMetadata: (instanceId: string, metadata: Record<string, string>) => void;
}

export function ClassManager({
  classes,
  instances,
  annotations,
  currentFrame,
  overlays,
  selectedClassId,
  showLabels,
  onToggleOverlay,
  onShowLabelsChange,
  onSelectClass,
  onCreateClass,
  onRenameClass,
  onUpdateClassPrompt,
  onUpdateClassColor,
  onDeleteClass,
  onRenameInstance,
  onDeleteInstance,
  onUpdateMetadata,
}: ClassManagerProps) {
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [editingClassId, setEditingClassId] = useState<string>();
  const [editValue, setEditValue] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string>();
  const [promptValue, setPromptValue] = useState("");
  const [colorPickerId, setColorPickerId] = useState<string>();

  const toggleClassExpanded = (classId: string) => {
    const newExpanded = new Set(expandedClasses);
    if (newExpanded.has(classId)) {
      newExpanded.delete(classId);
    } else {
      newExpanded.add(classId);
    }
    setExpandedClasses(newExpanded);
  };

  const startEditing = (cls: Class) => {
    setEditingClassId(cls.id);
    setEditValue(cls.name);
  };

  const cancelEditing = () => {
    setEditingClassId(undefined);
    setEditValue("");
  };

  const saveEdit = (classId: string) => {
    if (editValue.trim()) {
      onRenameClass(classId, editValue.trim());
    }
    cancelEditing();
  };

  const handleCreateClass = () => {
    if (newClassName.trim()) {
      onCreateClass(newClassName.trim());
      setNewClassName("");
    }
  };

  // Check if an annotation is visible on the current frame
  const isAnnotationVisibleOnFrame = (annotation: Annotation, frame: number): boolean => {
    // Check if annotation was created on this frame
    if (annotation.frameCreated === frame) {
      return true;
    }
    
    // Check if frame is within any tracked ranges
    if (annotation.trackedFrames) {
      return annotation.trackedFrames.some(([start, end]) => frame >= start && frame <= end);
    }
    
    return false;
  };

  // Get instances for a class that are visible on the current frame
  const getInstancesForClass = (classId: string) => {
    return instances.filter(inst => {
      if (inst.classId !== classId) return false;
      
      // Check if any annotation for this instance is visible on current frame
      const instanceAnnotations = annotations.filter(ann => ann.instanceId === inst.id);
      return instanceAnnotations.some(ann => isAnnotationVisibleOnFrame(ann, currentFrame));
    });
  };

  const getAnnotationsForInstance = (instanceId: string) => {
    return annotations.filter(ann => ann.instanceId === instanceId);
  };

  return (
    <Card className="p-4 bg-card border-border">
      <h3 className="text-sm font-semibold mb-3">Classes</h3>

      {/* Overlay toggles */}
      <div className="mb-4 p-3 bg-muted/30 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="segments-toggle" className="text-xs">
            Show Segments <span className="text-muted-foreground/60">(1)</span>
          </Label>
          <Switch
            id="segments-toggle"
            checked={overlays.segments}
            onCheckedChange={() => onToggleOverlay("segments")}
            className="scale-75"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="bboxes-toggle" className="text-xs">
            Show BBoxes <span className="text-muted-foreground/60">(2)</span>
          </Label>
          <Switch
            id="bboxes-toggle"
            checked={overlays.bboxes}
            onCheckedChange={() => onToggleOverlay("bboxes")}
            className="scale-75"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="points-toggle" className="text-xs">
            Show Points <span className="text-muted-foreground/60">(3)</span>
          </Label>
          <Switch
            id="points-toggle"
            checked={overlays.points}
            onCheckedChange={() => onToggleOverlay("points")}
            className="scale-75"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="labels-toggle" className="text-xs">
            Show BBox Labels <span className="text-muted-foreground/60">(4)</span>
          </Label>
          <Switch
            id="labels-toggle"
            checked={showLabels}
            onCheckedChange={onShowLabelsChange}
            className="scale-75"
          />
        </div>
      </div>

      {/* Create new class */}
      <div className="mb-4 flex gap-2">
        <Input
          placeholder="New class name (e.g., Sail)"
          value={newClassName}
          onChange={(e) => setNewClassName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateClass();
            if (e.key === "Escape") setNewClassName("");
          }}
          className="h-8 text-sm"
        />
        <Button
          onClick={handleCreateClass}
          size="sm"
          className="h-8"
          disabled={!newClassName.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Classes list */}
      <div className="space-y-1">
        {classes.map((cls) => {
          const classInstances = getInstancesForClass(cls.id);
          const isExpanded = expandedClasses.has(cls.id);
          const isSelected = selectedClassId === cls.id;

          return (
            <div key={cls.id} className="space-y-1">
              {/* Class row */}
              <div
                className={`flex items-center gap-2 p-2 rounded hover:bg-muted/50 transition-colors ${
                  isSelected ? "bg-muted" : ""
                }`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleClassExpanded(cls.id)}
                  className="h-5 w-5 p-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </Button>
                <button
                  className="w-3 h-3 rounded-full flex-shrink-0 ring-offset-1 hover:ring-2 ring-ring"
                  style={{ backgroundColor: cls.color }}
                  title="Change color"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerId((id) => (id === cls.id ? undefined : cls.id));
                  }}
                />
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onSelectClass(cls.id)}
                >
                  {editingClassId === cls.id ? (
                    <div className="flex items-center gap-1 mb-0.5">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(cls.id);
                          if (e.key === "Escape") cancelEditing();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-auto py-0 px-0 text-sm font-medium border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveEdit(cls.id);
                        }}
                        className="h-5 w-5 p-0"
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
                        className="h-5 w-5 p-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="text-sm font-medium cursor-pointer hover:underline transition-all mb-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(cls);
                      }}
                      title="Click to rename"
                    >
                      {cls.name}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {classInstances.length} instance{classInstances.length !== 1 ? "s" : ""}
                  </div>
                  {editingPromptId === cls.id ? (
                    <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                      <Wand2 className="h-2.5 w-2.5 flex-shrink-0 text-muted-foreground/70" />
                      <Input
                        value={promptValue}
                        onChange={(e) => setPromptValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { onUpdateClassPrompt(cls.id, promptValue.trim() || cls.name); setEditingPromptId(undefined); }
                          if (e.key === "Escape") setEditingPromptId(undefined);
                        }}
                        onBlur={() => { onUpdateClassPrompt(cls.id, promptValue.trim() || cls.name); setEditingPromptId(undefined); }}
                        className="h-5 py-0 px-1 text-[10px] border-0 bg-transparent focus-visible:ring-1"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1 text-[10px] text-muted-foreground/70 truncate cursor-text hover:text-foreground"
                      title="SAM3 concept phrase — click to edit"
                      onClick={(e) => { e.stopPropagation(); setEditingPromptId(cls.id); setPromptValue(cls.conceptPrompt ?? cls.name); }}
                    >
                      <Wand2 className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="truncate">{cls.conceptPrompt ?? cls.name}</span>
                    </div>
                  )}
                </div>
                {editingClassId !== cls.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteClass(cls.id);
                    }}
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {/* Color swatches (when the color dot is clicked) */}
              {colorPickerId === cls.id && (
                <div className="ml-8 flex flex-wrap gap-1.5 py-1">
                  {SAIL_COLORS.map((sw) => (
                    <button
                      key={sw.hex}
                      title={sw.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateClassColor(cls.id, sw.hex, sw.name);
                        setColorPickerId(undefined);
                      }}
                      className={`w-4 h-4 rounded-full ring-offset-1 hover:scale-110 transition-transform ${cls.color === sw.hex ? "ring-2 ring-ring" : ""}`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                </div>
              )}

              {/* Instances (when expanded) */}
              {isExpanded && (
                <div className="ml-8">
                  <InstanceManager
                    classData={cls}
                    instances={classInstances}
                    annotations={annotations}
                    currentFrame={currentFrame}
                    onRenameInstance={onRenameInstance}
                    onDeleteInstance={onDeleteInstance}
                    onUpdateMetadata={onUpdateMetadata}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {classes.length === 0 && (
        <div className="text-center py-6">
          <div className="text-sm text-muted-foreground">
            No classes yet. Create one to start annotating.
          </div>
        </div>
      )}

      {/* Quick tips */}
      <div className="mt-4 p-3 bg-muted/30 rounded text-xs text-muted-foreground space-y-1">
        <div className="font-semibold mb-2">Quick tips:</div>
        <div>• Create a class (e.g., "Sail") before annotating</div>
        <div>• Select a class, then click video to create instances</div>
        <div>• Expand classes (^) to see individual instances</div>
        <div>• Add metadata to instances (brand, model, etc.)</div>
      </div>
    </Card>
  );
}
