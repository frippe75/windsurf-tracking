import { config } from './config';

// Mock data generator for detect-objects
const generateMockDetections = (frameWidth: number, frameHeight: number) => {
  const PREDEFINED_CLASSES = [
    { name: "Sail", color: "#ef4444", colorName: "red" },
    { name: "Boat", color: "#3b82f6", colorName: "blue" },
    { name: "Person", color: "#10b981", colorName: "green" },
    { name: "Buoy", color: "#f59e0b", colorName: "amber" },
  ];

  const numDetections = Math.floor(Math.random() * 2) + 3;
  const detections = [];

  for (let i = 0; i < numDetections; i++) {
    const classInfo = PREDEFINED_CLASSES[i % PREDEFINED_CLASSES.length];
    
    const width = Math.floor(frameWidth * (0.1 + Math.random() * 0.3));
    const height = Math.floor(frameHeight * (0.1 + Math.random() * 0.3));
    const x = Math.floor(Math.random() * (frameWidth - width));
    const y = Math.floor(Math.random() * (frameHeight - height));
    
    const numPoints = 8;
    const points = [];
    for (let j = 0; j < numPoints; j++) {
      const angle = (j / numPoints) * Math.PI * 2;
      const radiusX = width / 2 * (0.8 + Math.random() * 0.4);
      const radiusY = height / 2 * (0.8 + Math.random() * 0.4);
      points.push({
        x: x + width / 2 + Math.cos(angle) * radiusX,
        y: y + height / 2 + Math.sin(angle) * radiusY,
      });
    }
    
    detections.push({
      className: classInfo.name,
      color: classInfo.color,
      colorName: classInfo.colorName,
      bbox: { x, y, w: width, h: height },
      points,
      confidence: 0.85 + Math.random() * 0.15,
    });
  }

  return { detections };
};

// API service for detect-objects endpoint
export const detectObjects = async (frameWidth: number, frameHeight: number) => {
  if (config.useMockApi) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return generateMockDetections(frameWidth, frameHeight);
  }

  // Real API call - FastAPI (not configured yet)
  throw new Error(
    'Object detection endpoint is not configured. Please implement it on FastAPI and update detectObjects in src/lib/api.ts.'
  );
};

// Scene Detection Types
export interface Scene {
  scene_id: number;
  start_frame: number;
  end_frame: number;
  start_time: number;
  end_time: number;
  duration: number;
  quality: string;
}

export interface SceneDetectionResponse {
  video_id: string;
  total_scenes: number;
  detection_method: string;
  threshold: number;
  scenes: Scene[];
}

// Mock scene detection generator
const generateMockScenes = (videoId: string): SceneDetectionResponse => {
  const mockScenes: Scene[] = [
    {
      scene_id: 1,
      start_frame: 0,
      end_frame: 336,
      start_time: 0.0,
      end_time: 14.014,
      duration: 14.014,
      quality: "unknown"
    },
    {
      scene_id: 2,
      start_frame: 336,
      end_frame: 1968,
      start_time: 14.014,
      end_time: 82.082,
      duration: 68.068,
      quality: "unknown"
    },
    {
      scene_id: 3,
      start_frame: 1968,
      end_frame: 2544,
      start_time: 82.082,
      end_time: 106.106,
      duration: 24.024,
      quality: "unknown"
    },
    {
      scene_id: 4,
      start_frame: 2544,
      end_frame: 3120,
      start_time: 106.106,
      end_time: 130.13,
      duration: 24.024,
      quality: "unknown"
    }
  ];

  return {
    video_id: videoId,
    total_scenes: mockScenes.length,
    detection_method: "Mock PySceneDetect ContentDetector",
    threshold: 30.0,
    scenes: mockScenes
  };
};

// Scene detection endpoint
export const detectScenes = async (videoId: string): Promise<SceneDetectionResponse> => {
  if (config.useMockApi) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800));
    return generateMockScenes(videoId);
  }

  // Real API call to FastAPI backend
  const response = await fetch(`${config.backendUrl}/api/videos/${videoId}/scenes/detect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Scene detection failed: ${response.statusText}`);
  }

  return await response.json();
};

// Video Upload Types
export interface VideoUploadResponse {
  video_id: string;
  filename: string;
  duration: number;
  fps: number;
  resolution: string;
  total_frames: number;
  message: string;
}

// Video upload endpoint
export const uploadVideo = async (file: File): Promise<VideoUploadResponse> => {
  if (config.useMockApi) {
    // Simulate upload delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Mock response
    return {
      video_id: `mock-${Date.now()}`,
      filename: file.name,
      duration: 120.5,
      fps: 30,
      resolution: "1920x1080",
      total_frames: 3615,
      message: "Video uploaded successfully (mock)"
    };
  }

  // Real API call to FastAPI backend
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${config.backendUrl}/api/videos/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Video upload failed: ${response.statusText}`);
  }

  return await response.json();
};

// Add more API functions here as needed
