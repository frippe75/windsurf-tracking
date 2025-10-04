export interface ManagedVideo {
  id: string;                    // video_id from backend
  filename: string;
  status: VideoStatus;
  
  // Progress tracking
  backendProgress?: number;      // 0-100 (YouTube → Backend)
  frontendProgress?: number;     // 0-100 (Backend → Cache)
  
  // Metadata
  metadata?: {
    duration: number;
    fps: number;
    width: number;
    height: number;
    totalFrames: number;
    fileSize?: number;
  };
  
  // States
  isActive: boolean;             // Currently being edited
  createdAt: number;
  lastAccessedAt: number;
  
  // Source
  youtubeUrl?: string;           // Original YouTube URL if from YouTube
  
  // Error handling
  error?: string;
}

export type VideoStatus = 
  | 'queued'           // In download queue
  | 'downloading'      // YouTube → Backend (DC network)
  | 'syncing'          // Backend → Frontend Cache
  | 'ready'            // Ready for editing
  | 'error';           // Failed state
