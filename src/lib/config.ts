// Configuration for API endpoints
export const config = {
  // Use mock API when VITE_USE_MOCK_API is set to 'true', otherwise use real endpoints
  useMockApi: import.meta.env.VITE_USE_MOCK_API === 'true',
  
  
  // FastAPI Backend URL
  // Priority: VITE_BACKEND_URL > defaults based on environment
  backendUrl: import.meta.env.VITE_BACKEND_URL || 
    (import.meta.env.PROD 
      ? 'https://lablebee.tclab.org'  // Production
      : 'http://localhost:8000'        // Local development
    ),
};
