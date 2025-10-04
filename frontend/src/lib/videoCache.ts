/**
 * IndexedDB Video Cache Service
 * Provides local browser storage for video files to enable instant loading
 */

export interface CachedVideo {
  videoId: string;
  filename: string;
  blob: Blob;
  metadata: {
    duration: number;
    fps: number;
    width: number;
    height: number;
    totalFrames: number;
    cachedAt: number;
  };
}

export interface CacheStats {
  count: number;
  totalSize: number;
  videos: Array<{
    filename: string;
    videoId: string;
    size: number;
    cachedAt: number;
  }>;
}

class VideoCacheService {
  private dbName = 'lablebee-video-cache';
  private storeName = 'videos';
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<void> {
    // Return existing initialization if in progress
    if (this.initPromise) return this.initPromise;
    
    // Already initialized
    if (this.db) return;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('💾 IndexedDB initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'filename' });
          objectStore.createIndex('videoId', 'videoId', { unique: false });
          objectStore.createIndex('cachedAt', 'metadata.cachedAt', { unique: false });
          console.log('💾 Created IndexedDB object store');
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Check if a video exists in cache by filename
   */
  async has(filename: string): Promise<boolean> {
    try {
      await this.init();
      if (!this.db) return false;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.count(filename);

        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error checking cache:', error);
      return false;
    }
  }

  /**
   * Get a video from cache by filename
   */
  async get(filename: string): Promise<CachedVideo | null> {
    try {
      await this.init();
      if (!this.db) return null;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(filename);

        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            console.log('💾 Cache HIT for:', filename);
          }
          resolve(result || null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting from cache:', error);
      return null;
    }
  }

  /**
   * Store a video in cache
   */
  async set(filename: string, video: CachedVideo): Promise<void> {
    try {
      await this.init();
      if (!this.db) {
        console.warn('Cannot cache video: IndexedDB not initialized');
        return;
      }

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(video);

        request.onsuccess = () => {
          console.log('💾 Video cached successfully:', filename, `(${(video.blob.size / 1024 / 1024).toFixed(2)} MB)`);
          resolve();
        };
        request.onerror = () => {
          console.error('Failed to cache video:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error caching video:', error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Delete a video from cache by filename
   */
  async delete(filename: string): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(filename);

        request.onsuccess = () => {
          console.log('💾 Video removed from cache:', filename);
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error deleting from cache:', error);
    }
  }

  /**
   * Clear all cached videos
   */
  async clear(): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();

        request.onsuccess = () => {
          console.log('💾 Cache cleared');
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      await this.init();
      if (!this.db) {
        return { count: 0, totalSize: 0, videos: [] };
      }

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          const videos: CachedVideo[] = request.result;
          const stats: CacheStats = {
            count: videos.length,
            totalSize: videos.reduce((sum, v) => sum + v.blob.size, 0),
            videos: videos.map(v => ({
              filename: v.filename,
              videoId: v.videoId,
              size: v.blob.size,
              cachedAt: v.metadata.cachedAt,
            })),
          };
          resolve(stats);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return { count: 0, totalSize: 0, videos: [] };
    }
  }
}

// Export singleton instance
export const videoCache = new VideoCacheService();
