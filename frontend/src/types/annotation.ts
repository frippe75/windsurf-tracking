// Core data structures for hierarchical annotation system

export interface Class {
  id: string;
  name: string;
  color: string;
  colorName: string;
  conceptPrompt?: string; // SAM3 open-vocab detection phrase for this class (defaults to name)
}

export interface Instance {
  id: string;
  classId: string;
  instanceNumber: number;
  name?: string; // optional custom name (defaults to "ClassName#N")
  metadata: Record<string, string>; // e.g., { brand: "North Sails", model: "E_Type" }
}

export interface Annotation {
  id: string;
  instanceId: string;
  frameCreated: number;
  points: Array<{ x: number; y: number }>;
  bbox?: { x: number; y: number; w: number; h: number };
  trackedFrames?: Array<[number, number]>; // Array of [start, end] ranges where object is tracked
  sam2Prompts?: Array<{ x: number; y: number; type: 'positive' | 'negative' }>; // SAM2 point prompts
  // SAM2 mask overlay (percentage-based bbox relative to displayed video area)
  maskBase64?: string;
  maskBBox?: { x: number; y: number; w: number; h: number };
  maskWidth?: number;
  maskHeight?: number;
  maskIsCropped?: boolean;
  isKeyframe: boolean; // True if manually created, false if from tracking
  // Track thinning (SAM3 video tracks): which track produced this annotation, its per-frame score,
  // and whether it's been thinned out. `excluded` is DERIVED from the track's thinning ops (see
  // lib/applyThinning) — non-destructive: it's omitted from export but never deleted.
  trackId?: string;
  score?: number;
  excluded?: boolean;
}

export interface Keyframe {
  frame: number;
  type: "START" | "STOP" | "SKIP" | "META";
  timestamp: string;
  metadata?: Record<string, string>; // Frame-level metadata for META keyframes
}

export interface Scene {
  id: string;
  startFrame: number;
  endFrame: number;
  quality: "good" | "bad" | "unknown";
  metadata?: Record<string, string>; // Scene-level metadata from AI annotation
}

// A SAM3 video track's thinning recipe. Ops apply in order, each narrowing the surviving frames;
// the union is extensible — add a `kind` here + a case in lib/applyThinning to support a new op.
export type ThinOp =
  | { kind: "everyN"; n: number }              // keep every Nth surviving frame
  | { kind: "minScaleDeltaPct"; pct: number }  // keep frames whose bbox area changed >= pct% vs last kept
  | { kind: "minScore"; v: number }            // keep frames with score >= v (missing score -> kept)
  | { kind: "maxPerTrack"; k: number };        // evenly subsample survivors down to at most k

export interface Track {
  id: string;
  startFrame: number;
  endFrame: number;
  prompt: string;
  createdAt: number;
  thinning: ThinOp[]; // ordered, stackable; empty = keep everything
}

// A dataset-level metadata field. Categorical (enum) fields are what make balance measurable.
// `scope` decides where the extracted value lands: whole-clip (scene), the object (instance), or video.
export interface MetaField {
  key: string;
  scope: "scene" | "instance" | "video";
  type: "enum" | "text";
  values?: string[]; // for type "enum"
}
