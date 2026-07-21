/**
 * Annotation workspace domain, extracted from pages/Index.tsx.
 *
 * Owns: classes, instances, annotations, keyframes, scenes, videoMetadata,
 * plus the class-selection and palette cursor (selectedClassId, colorIndex),
 * and their handlers (class management, instance management, annotation
 * update/prompt removal, keyframe toggling, scene quality).
 *
 * Pure list semantics live in lib/annotationOps (unit-tested there); this
 * hook only binds them to React state and toasts. Cross-domain orchestration
 * (SAM2 canvas clicks, tracking-result ingestion, project load/save) stays
 * in the page and uses the exposed setters.
 */

import { useState } from "react";
import { Class, Instance, Annotation, Keyframe, Scene, Track, ThinOp } from "@/types/annotation";
import { recomputeExclusions } from "@/lib/applyThinning";
import {
  createClass,
  leastUsedColorIndex,
  SAIL_COLORS,
  renameClassById,
  deleteClassCascade,
  renameInstanceById,
  removeInstanceById,
  removeAnnotationsForInstance,
  updateInstanceMetadata,
  updateAnnotationById,
  removePromptFromAnnotation,
  toggleKeyframe,
  deleteKeyframesAtFrame,
  setSceneQuality,
} from "@/lib/annotationOps";
import type { ToastOptions } from "@/hooks/useProjects";

export interface UseAnnotationsOptions {
  /** Current playhead frame (keyframes toggle at this frame). */
  currentFrame: number;
  toast: (options: ToastOptions) => void;
}

export function useAnnotations({ currentFrame, toast }: UseAnnotationsOptions) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [videoMetadata, setVideoMetadata] = useState<Record<string, string>>({});
  const [selectedClassId, setSelectedClassId] = useState<string>();
  const [colorIndex, setColorIndex] = useState(0);

  const handleCreateClass = (name: string) => {
    // Pick the least-used palette color so classes don't collapse to one color.
    setClasses((prev) => {
      const newClass = createClass(name, leastUsedColorIndex(prev));
      setSelectedClassId(newClass.id);
      toast({ title: "Class created", description: name });
      return [...prev, newClass];
    });
    setColorIndex((prev) => prev + 1); // kept: consumed by an Index effect's deps
  };

  const handleUpdateClassColor = (classId: string, hex: string, colorName?: string) => {
    const name = colorName ?? SAIL_COLORS.find((c) => c.hex === hex)?.name ?? "Custom";
    setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, color: hex, colorName: name } : c)));
  };

  const handleRenameClass = (classId: string, newName: string) => {
    setClasses((prev) => renameClassById(prev, classId, newName));
  };

  const handleUpdateClassPrompt = (classId: string, conceptPrompt: string) => {
    setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, conceptPrompt } : c)));
  };

  const handleDeleteClass = (classId: string) => {
    const cascaded = deleteClassCascade(classes, instances, annotations, classId);
    setClasses(cascaded.classes);
    setInstances(cascaded.instances);
    setAnnotations(cascaded.annotations);

    if (selectedClassId === classId) {
      setSelectedClassId(undefined);
    }

    toast({
      title: "Class deleted",
      description: "All instances and annotations removed",
    });
  };

  const handleRenameInstance = (instanceId: string, newName: string) => {
    setInstances((prev) => renameInstanceById(prev, instanceId, newName));
  };

  const handleDeleteInstance = (instanceId: string) => {
    setInstances((prev) => removeInstanceById(prev, instanceId));
    setAnnotations((prev) => removeAnnotationsForInstance(prev, instanceId));
    toast({
      title: "Instance deleted",
    });
  };

  const handleUpdateMetadata = (instanceId: string, metadata: Record<string, string>) => {
    setInstances((prev) => updateInstanceMetadata(prev, instanceId, metadata));
  };

  const handleAnnotationUpdate = (annotationId: string, updates: Partial<Annotation>) => {
    setAnnotations((prev) => updateAnnotationById(prev, annotationId, updates));
  };

  const handleAddKeyframe = (type: Keyframe["type"]) => {
    const result = toggleKeyframe(keyframes, currentFrame, type, new Date().toISOString());
    setKeyframes(result.keyframes);
    toast({
      title: `${type} keyframe ${result.added ? "added" : "removed"}`,
      description: `Frame ${currentFrame}`,
    });
  };

  const handleDeleteKeyframe = (frame: number) => {
    setKeyframes((prev) => deleteKeyframesAtFrame(prev, frame));
  };

  const handleDeletePrompt = (annotationId: string, promptIndex: number) => {
    setAnnotations((prev) => removePromptFromAnnotation(prev, annotationId, promptIndex));
    toast({
      title: "Prompt deleted",
      description: "SAM2 point removed from annotation",
    });
  };

  // Update a track's thinning ops and recompute `excluded` on its annotations (non-destructive).
  const handleUpdateTrackThinning = (trackId: string, thinning: ThinOp[]) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, thinning } : t)));
    const t = tracks.find((x) => x.id === trackId);
    if (t) setAnnotations((prev) => recomputeExclusions(prev, { ...t, thinning }));
  };

  const handleSceneQualityChange = (sceneId: string, quality: Scene["quality"]) => {
    setScenes((prev) => setSceneQuality(prev, sceneId, quality));
  };

  return {
    // state + setters (cross-domain orchestration in the page uses these)
    classes,
    setClasses,
    instances,
    setInstances,
    annotations,
    setAnnotations,
    keyframes,
    setKeyframes,
    scenes,
    setScenes,
    tracks,
    setTracks,
    handleUpdateTrackThinning,
    videoMetadata,
    setVideoMetadata,
    selectedClassId,
    setSelectedClassId,
    colorIndex,
    setColorIndex,
    // handlers
    handleCreateClass,
    handleRenameClass,
    handleUpdateClassPrompt,
    handleUpdateClassColor,
    handleDeleteClass,
    handleRenameInstance,
    handleDeleteInstance,
    handleUpdateMetadata,
    handleAnnotationUpdate,
    handleAddKeyframe,
    handleDeleteKeyframe,
    handleDeletePrompt,
    handleSceneQualityChange,
  };
}
