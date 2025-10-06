import { Class, Instance, Annotation, Keyframe, Scene } from "./annotation";

export interface Project {
  id: string;                    // UUID
  name: string;                  // User-editable project name
  videoId: string;               // Links to backend video
  videoFilename: string;         // Display name
  createdAt: number;             // Timestamp
  lastModified: number;          // Timestamp
  
  // All annotation state
  classes: Class[];
  instances: Instance[];
  annotations: Annotation[];
  keyframes: Keyframe[];
  scenes: Scene[];               // Includes quality marks
  videoMetadata: Record<string, string>;
}

export interface ProjectMetrics {
  totalClasses: number;
  totalInstances: number;
  totalAnnotations: number;
  totalKeyframes: number;
  totalScenes: number;
}

export function getProjectMetrics(project: Project): ProjectMetrics {
  return {
    totalClasses: project.classes.length,
    totalInstances: project.instances.length,
    totalAnnotations: project.annotations.length,
    totalKeyframes: project.keyframes.length,
    totalScenes: project.scenes.length,
  };
}

export function createEmptyProject(videoId: string, videoFilename: string): Project {
  return {
    id: crypto.randomUUID(),
    name: videoFilename.replace(/\.[^/.]+$/, ""), // Remove extension
    videoId,
    videoFilename,
    createdAt: Date.now(),
    lastModified: Date.now(),
    classes: [],
    instances: [],
    annotations: [],
    keyframes: [],
    scenes: [],
    videoMetadata: {},
  };
}
