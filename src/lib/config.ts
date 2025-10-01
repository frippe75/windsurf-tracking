// Configuration for API endpoints
export const config = {
  // Use mock API when VITE_USE_MOCK_API is set to 'true', otherwise use real endpoints
  useMockApi: import.meta.env.VITE_USE_MOCK_API === 'true',
  
  // Base URL for Supabase functions
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  
  // Local backend URL (when developing locally)
  localBackendUrl: import.meta.env.VITE_LOCAL_BACKEND_URL || 'http://localhost:3000',
};
