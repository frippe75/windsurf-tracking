/**
 * Extract a single frame from a video blob as a base64 data URL
 */
export async function extractFrameFromVideo(
  videoBlob: Blob,
  frameNumber: number,
  fps: number,
  width: number = 120,
  height: number = 68
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    const blobUrl = URL.createObjectURL(videoBlob);
    let resolved = false;

    video.preload = 'metadata';
    video.muted = true;
    
    const cleanup = () => {
      URL.revokeObjectURL(blobUrl);
      video.remove();
    };

    video.onloadedmetadata = () => {
      const seekTime = frameNumber / fps;
      
      // Clamp to video duration
      if (seekTime > video.duration) {
        cleanup();
        reject(new Error('Frame number exceeds video duration'));
        return;
      }
      
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      if (resolved) return;
      resolved = true;

      try {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(video, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        cleanup();
        resolve(dataUrl);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video'));
    };

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error('Frame extraction timeout'));
      }
    }, 5000);

    video.src = blobUrl;
  });
}
