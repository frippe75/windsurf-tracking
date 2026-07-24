/**
 * Pure list operations for the annotation domain (classes, instances,
 * annotations, keyframes, scenes). Extracted from pages/Index.tsx so the
 * stateful hook (hooks/useAnnotations) stays thin and the semantics are
 * directly unit-testable.
 *
 * All functions are pure: they never mutate their inputs.
 */

import { Class, Instance, Annotation, Keyframe, Scene } from "@/types/annotation";

/** Class color palette (distinct hues; new classes pick the least-used one). */
export const SAIL_COLORS = [
  { hex: "hsl(142, 71%, 45%)", name: "Green" },
  { hex: "hsl(217, 91%, 60%)", name: "Blue" },
  { hex: "hsl(25, 95%, 53%)", name: "Orange" },
  { hex: "hsl(271, 81%, 56%)", name: "Purple" },
  { hex: "hsl(48, 96%, 53%)", name: "Yellow" },
  { hex: "hsl(334, 79%, 58%)", name: "Pink" },
  { hex: "hsl(190, 90%, 45%)", name: "Cyan" },
  { hex: "hsl(0, 84%, 60%)", name: "Red" },
  { hex: "hsl(96, 60%, 45%)", name: "Lime" },
  { hex: "hsl(255, 70%, 65%)", name: "Indigo" },
];

/**
 * Index of the palette color least used by the current classes, so new classes get a
 * distinct color instead of all collapsing to the same one (the old monotonic colorIndex
 * drifted out of sync with loaded/imported classes). Ties resolve to the earliest palette slot.
 */
export function leastUsedColorIndex(classes: Class[]): number {
  const counts = SAIL_COLORS.map((c) => classes.filter((k) => k.color === c.hex).length);
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] < counts[best]) best = i;
  return best;
}

/** Build a new class with the palette color for the given colorIndex. */
export function createClass(
  name: string,
  colorIndex: number,
  now: () => number = Date.now
): Class {
  const color = SAIL_COLORS[colorIndex % SAIL_COLORS.length];
  return {
    id: `class-${now()}`,
    name,
    color: color.hex,
    colorName: color.name,
    conceptPrompt: name, // seed the SAM3 phrase from the class name; editable in the Detect tool
  };
}

export function renameClassById(classes: Class[], classId: string, newName: string): Class[] {
  return classes.map((c) => (c.id === classId ? { ...c, name: newName } : c));
}

/** Delete a class and cascade to its instances and their annotations. */
export function deleteClassCascade(
  classes: Class[],
  instances: Instance[],
  annotations: Annotation[],
  classId: string
): { classes: Class[]; instances: Instance[]; annotations: Annotation[] } {
  const instanceIds = instances.filter((inst) => inst.classId === classId).map((inst) => inst.id);
  return {
    classes: classes.filter((c) => c.id !== classId),
    instances: instances.filter((inst) => inst.classId !== classId),
    annotations: annotations.filter((ann) => !instanceIds.includes(ann.instanceId)),
  };
}

export function renameInstanceById(
  instances: Instance[],
  instanceId: string,
  newName: string
): Instance[] {
  return instances.map((inst) => (inst.id === instanceId ? { ...inst, name: newName } : inst));
}

export function removeInstanceById(instances: Instance[], instanceId: string): Instance[] {
  return instances.filter((inst) => inst.id !== instanceId);
}

export function removeAnnotationsForInstance(
  annotations: Annotation[],
  instanceId: string
): Annotation[] {
  return annotations.filter((ann) => ann.instanceId !== instanceId);
}

export function updateInstanceMetadata(
  instances: Instance[],
  instanceId: string,
  metadata: Record<string, string>
): Instance[] {
  return instances.map((inst) => (inst.id === instanceId ? { ...inst, metadata } : inst));
}

/** 1-based instance number for the next instance of a class. */
export function nextInstanceNumber(instances: Instance[], classId: string): number {
  return instances.filter((inst) => inst.classId === classId).length + 1;
}

export function updateAnnotationById(
  annotations: Annotation[],
  annotationId: string,
  updates: Partial<Annotation>
): Annotation[] {
  return annotations.map((ann) => (ann.id === annotationId ? { ...ann, ...updates } : ann));
}

/** Annotations created at a specific frame (per-frame filtering). */
export function annotationsAtFrame(annotations: Annotation[], frame: number): Annotation[] {
  return annotations.filter((ann) => ann.frameCreated === frame);
}

/**
 * Annotations belonging to a given clip. A project can hold several videos that share one
 * annotation array, so frame-position views (canvas overlay, timeline) must scope to the loaded
 * clip — otherwise one clip's boxes bleed onto another clip's identical frame numbers.
 * Legacy annotations created before scoping have no `videoId` and fall through to the current clip
 * (never hidden — non-destructive to pre-existing work).
 */
export function annotationsForVideo(annotations: Annotation[], videoId: string): Annotation[] {
  return annotations.filter((ann) => !ann.videoId || ann.videoId === videoId);
}

/**
 * Remove one SAM2 prompt (by index) from an annotation. An emptied prompt
 * list becomes `undefined` (matches the original Index.tsx semantics).
 */
export function removePromptFromAnnotation(
  annotations: Annotation[],
  annotationId: string,
  promptIndex: number
): Annotation[] {
  return annotations.map((ann) => {
    if (ann.id === annotationId && ann.sam2Prompts) {
      const updatedPrompts = ann.sam2Prompts.filter((_, i) => i !== promptIndex);
      return { ...ann, sam2Prompts: updatedPrompts.length > 0 ? updatedPrompts : undefined };
    }
    return ann;
  });
}

/**
 * Toggle a keyframe of a given type at a frame: remove it when present,
 * add it (with the provided timestamp) when absent.
 */
export function toggleKeyframe(
  keyframes: Keyframe[],
  frame: number,
  type: Keyframe["type"],
  timestamp: string
): { keyframes: Keyframe[]; added: boolean } {
  const exists = keyframes.some((k) => k.frame === frame && k.type === type);
  if (exists) {
    return {
      keyframes: keyframes.filter((k) => !(k.frame === frame && k.type === type)),
      added: false,
    };
  }
  return {
    keyframes: [...keyframes, { frame, type, timestamp }],
    added: true,
  };
}

/** Remove ALL keyframes at a frame (regardless of type — original semantics). */
export function deleteKeyframesAtFrame(keyframes: Keyframe[], frame: number): Keyframe[] {
  return keyframes.filter((k) => k.frame !== frame);
}

export function setSceneQuality(
  scenes: Scene[],
  sceneId: string,
  quality: Scene["quality"]
): Scene[] {
  return scenes.map((s) => (s.id === sceneId ? { ...s, quality } : s));
}
