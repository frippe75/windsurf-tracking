import { config } from './config';

// Backend Health Check Types
export interface HealthCheckResponse {
  message: string;
  version: string;
  status: string;
}

// Health check endpoint
export const checkBackendHealth = async (): Promise<HealthCheckResponse | null> => {
  if (config.useMockApi) {
    // Mock mode - always healthy
    return {
      message: "Windsurf Dataset API (Mock)",
      version: "1.0.0",
      status: "healthy"
    };
  }

  try {
    console.log('🔍 Checking backend health at:', config.backendUrl);
    const response = await fetch(`${config.backendUrl}/`, {
      method: 'GET',
      mode: 'cors',
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('❌ Backend health check failed for', config.backendUrl, ':', error);
    return null;
  }
};

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

// ============= AI Endpoints =============

// DINO Detection Types
export interface DINODetectionRequest {
  video_id: string;
  frame_number: number;
  confidence_threshold?: number;
}

export interface DINODetection {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface DINODetectionResponse {
  video_id: string;
  frame_number: number;
  detections: DINODetection[];
  model: string;
  confidence_threshold: number;
}

// DINO object detection endpoint
export const detectWithDINO = async (request: DINODetectionRequest): Promise<DINODetectionResponse> => {
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 600));
    
    return {
      video_id: request.video_id,
      frame_number: request.frame_number,
      model: "DINO (mock)",
      confidence_threshold: request.confidence_threshold || 0.3,
      detections: [
        {
          label: "Sail",
          confidence: 0.92,
          bbox: { x: 120, y: 80, w: 200, h: 180 }
        },
        {
          label: "Boat",
          confidence: 0.87,
          bbox: { x: 300, y: 200, w: 250, h: 150 }
        }
      ]
    };
  }

  const response = await fetch(`${config.backendUrl}/api/ai/dino/detect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`DINO detection failed: ${response.statusText}`);
  }

  return await response.json();
};

// SAM2 Segmentation Types
export interface SAM2ClickPrompt {
  x: number;
  y: number;
  type: 'positive' | 'negative';
}

export interface SAM2SegmentationRequest {
  video_id: string;
  frame_number: number;
  click_prompts: SAM2ClickPrompt[];
}

export interface SAM2SegmentationResponse {
  video_id: string;
  frame_number: number;
  mask: number[][];  // 2D array of mask values
  points: Array<{ x: number; y: number }>;  // Polygon points
  bbox: { x: number; y: number; w: number; h: number };
  model: string;
  success?: boolean;  // Backend may return success flag
  error?: string;     // Backend may return error message
}

// SAM2 segmentation endpoint
export const segmentWithSAM2 = async (request: SAM2SegmentationRequest): Promise<SAM2SegmentationResponse> => {
  console.log('🎯 SAM2 segmentation request:', request);
  console.log('🔗 Backend URL:', config.backendUrl);
  
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Generate mock polygon around click prompts
    const avgX = request.click_prompts.reduce((sum, p) => sum + p.x, 0) / request.click_prompts.length;
    const avgY = request.click_prompts.reduce((sum, p) => sum + p.y, 0) / request.click_prompts.length;
    
    const points = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      points.push({
        x: avgX + Math.cos(angle) * 80,
        y: avgY + Math.sin(angle) * 60
      });
    }
    
    return {
      video_id: request.video_id,
      frame_number: request.frame_number,
      model: "SAM2 (mock)",
      mask: [], // Mock empty mask
      points,
      bbox: {
        x: avgX - 80,
        y: avgY - 60,
        w: 160,
        h: 120
      }
    };
  }

  try {
    const response = await fetch(`${config.backendUrl}/api/ai/sam2/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ SAM2 API error:', response.status, errorText);
      throw new Error(`SAM2 segmentation failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ SAM2 response:', result);
    
    // Check if backend returned an error in the response body
    if (result.success === false || result.error) {
      throw new Error(result.error || 'SAM2 segmentation failed');
    }
    
    return result;
  } catch (error) {
    console.error('❌ SAM2 request failed:', error);
    throw error;
  }
};

// AI Status Types
export interface AIModelStatus {
  name: string;
  loaded: boolean;
  memory_mb?: number;
}

export interface AIStatusResponse {
  gpu_available: boolean;
  gpu_memory?: {
    total_gb: number;
    allocated_gb: number;
    available_gb: number;
    utilization_percent: number;
  };
  models: AIModelStatus[];
}

// AI status endpoint
export const getAIStatus = async (): Promise<AIStatusResponse> => {
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    return {
      gpu_available: true,
      gpu_memory: {
        total_gb: 24.0,
        allocated_gb: 8.5,
        available_gb: 15.5,
        utilization_percent: 35.4
      },
      models: [
        { name: "DINO", loaded: true, memory_mb: 2048 },
        { name: "SAM2", loaded: true, memory_mb: 4096 }
      ]
    };
  }

  const response = await fetch(`${config.backendUrl}/api/ai/status`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`AI status check failed: ${response.statusText}`);
  }

  return await response.json();
};

// ============= Tracking Endpoints =============

// Tracking Job Types
export interface TrackingSegment {
  start_frame: number;
  end_frame: number;
  click_prompts: Array<{ x: number; y: number; type: 'positive' | 'negative' }>;
}

export interface SubJob {
  job_id: string;
  name: string;
  start_frame: number;
  end_frame: number;
  frames: number;
  prompt_source: 'manual' | 'propagated';
}

export interface AutoSplitResult {
  split_required: boolean;
  estimated_memory?: string;
  max_frames_per_job?: number;
  created_jobs: SubJob[];
}

export interface CreateTrackingJobResponse {
  job_id: string;
  video_id?: string;
  auto_split_result?: AutoSplitResult;
  single_job?: {
    video_id: string;
    video_path: string;
    fps: number;
    job_id: string;
    name: string;
    start_frame: number;
    end_frame: number;
    frames: number;
    click_prompts: Array<{ x: number; y: number; type: 'positive' | 'negative' }>;
    estimated_memory: string;
    status: string;
  };
  message?: string;
}

export interface TrackingJobStatus {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_frame?: number;
  total_frames?: number;
  percentage?: number;
  frames_completed?: number;
  processing_time?: number;
  error?: string;
}

// Create tracking job with auto-split support
export const createTrackingJob = async (
  videoId: string, 
  segments: TrackingSegment[]
): Promise<CreateTrackingJobResponse> => {
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const totalFrames = segments[0].end_frame - segments[0].start_frame;
    const mockSubJobs: SubJob[] = totalFrames > 100 
      ? [
          { job_id: `mock-part-1`, name: 'Part 1/2', start_frame: segments[0].start_frame, end_frame: segments[0].start_frame + 50, frames: 50, prompt_source: 'manual' },
          { job_id: `mock-part-2`, name: 'Part 2/2', start_frame: segments[0].start_frame + 49, end_frame: segments[0].end_frame, frames: totalFrames - 49, prompt_source: 'propagated' }
        ]
      : [{ job_id: `mock-job`, name: 'Full Segment', start_frame: segments[0].start_frame, end_frame: segments[0].end_frame, frames: totalFrames, prompt_source: 'manual' }];
    
    return {
      job_id: `mock-parent-${Date.now()}`,
      video_id: videoId,
      auto_split_result: {
        split_required: totalFrames > 100,
        estimated_memory: totalFrames > 100 ? '12.5GB' : '5.2GB',
        max_frames_per_job: 100,
        created_jobs: mockSubJobs
      }
    };
  }

  const response = await fetch(`${config.backendUrl}/api/videos/${videoId}/tracking/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ segments }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create tracking job: ${response.statusText}`);
  }

  return await response.json();
};

// Execute tracking job
export const executeTrackingJob = async (jobId: string): Promise<{ job_id: string; status: string }> => {
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 200));
    return { job_id: jobId, status: 'started' };
  }

  const response = await fetch(`${config.backendUrl}/api/tracking/jobs/${jobId}/execute`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to execute tracking job: ${response.statusText}`);
  }

  return await response.json();
};

// Get tracking job status
export const getTrackingJobStatus = async (jobId: string): Promise<TrackingJobStatus> => {
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate progressive completion
    const randomProgress = Math.floor(Math.random() * 100);
    return {
      job_id: jobId,
      status: randomProgress < 100 ? 'running' : 'completed',
      current_frame: randomProgress,
      total_frames: 100,
      percentage: randomProgress,
      frames_completed: randomProgress,
      processing_time: randomProgress < 100 ? undefined : 5.3
    };
  }

  const response = await fetch(`${config.backendUrl}/api/tracking/jobs/${jobId}/status`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to get tracking job status: ${response.statusText}`);
  }

  return await response.json();
};

// Get tracking job results
export interface TrackingResult {
  frame_number: number;
  bbox: [number, number, number, number];  // [x1, y1, x2, y2]
  mask_base64?: string;
  score?: number;
}

export interface TrackingJobResults {
  job_id: string;
  video_id: string;
  start_frame: number;
  end_frame: number;
  results: TrackingResult[];
}

export const getTrackingJobResults = async (jobId: string): Promise<TrackingJobResults> => {
  if (config.useMockApi) {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Mock some tracking results
    const mockResults: TrackingResult[] = [];
    for (let frame = 0; frame < 20; frame++) {
      mockResults.push({
        frame_number: frame,
        bbox: [100 + frame * 2, 150, 300, 400],
        score: 0.9
      });
    }
    
    return {
      job_id: jobId,
      video_id: 'mock-video',
      start_frame: 0,
      end_frame: 20,
      results: mockResults
    };
  }

  const maxAttempts = 12; // ~12s total with 1s intervals
  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${config.backendUrl}/api/tracking/jobs/${jobId}/results`, {
      method: 'GET',
    });

    if (response.ok) {
      return await response.json();
    }

    // Results can briefly 404 while the backend finalizes artifacts after completion
    if (response.status === 404) {
      const waitMs = 1000; // fixed 1s retry
      console.warn(`⌛ Results 404 for job ${jobId} (attempt ${attempt}/${maxAttempts}). Retrying in ${waitMs}ms...`);
      await delay(waitMs);
      continue;
    }

    const errorText = await response.text().catch(() => '');
    throw new Error(`Failed to get tracking job results: ${response.status} ${response.statusText} ${errorText}`);
  }

  throw new Error(`Tracking results not available yet for job ${jobId} after ${maxAttempts} retries`);
};
