// Core data structures for hierarchical annotation system

export interface Class {
  id: string;
  name: string;
  color: string;
  colorName: string;
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
