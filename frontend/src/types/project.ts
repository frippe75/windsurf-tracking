import { Class, Instance, Annotation, Keyframe, Scene } from "./annotation";

export interface Project {
  id: string;                    // UUID
  name: string;                  // User-editable project name
  videoIds: string[];            // Array of video IDs in this dataset
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

export function createEmptyProject(name: string, videoIds: string[] = []): Project {
  return {
    id: crypto.randomUUID(),
    name,
    videoIds,
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
