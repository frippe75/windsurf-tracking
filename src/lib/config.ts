// Configuration for API endpoints

// Function to get backend URL dynamically
const getBackendUrl = () => {
  // Check if runtime override exists (set by BackendSelector)
  if (typeof window !== 'undefined' && (window as any).__LOVABLE_BACKEND_URL__) {
    return (window as any).__LOVABLE_BACKEND_URL__;
  }
  
  // Fallback to env variables or defaults
  return import.meta.env.VITE_BACKEND_URL || 
    (import.meta.env.PROD 
      ? 'https://lablebee.tclab.org'  // Production
      : 'http://localhost:8000'        // Local development
    );
};

export const config = {
  // Use mock API when VITE_USE_MOCK_API is set to 'true', otherwise use real endpoints
  useMockApi: import.meta.env.VITE_USE_MOCK_API === 'true',
  
  // FastAPI Backend URL - supports runtime switching
  get backendUrl() {
    return getBackendUrl();
  },
};
