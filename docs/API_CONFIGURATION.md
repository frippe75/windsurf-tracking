# API Configuration Guide

This project supports both mock and real API endpoints, making it easy to develop locally with or without a running backend.

## Quick Start

### Using Mock API (No Backend Required)

In Lovable or your local development, set the environment variable:
```
VITE_USE_MOCK_API=true
```

This will use client-side mock data generators for all API calls.

### Using Real Backend

For production or when developing with a real backend:
```
VITE_USE_MOCK_API=false
```

The app will call the actual Supabase edge functions.

## Local Development Setup

1. **Clone the repository**
   ```bash
   git clone your-repo-url
   cd your-project
   ```

2. **Create a `.env.local` file** (copy from `.env.example`)
   ```bash
   cp .env.example .env.local
   ```

3. **Choose your mode:**

   **Option A: Mock Mode** (no backend needed)
   ```env
   VITE_USE_MOCK_API=true
   ```

   **Option B: Local Supabase**
   ```env
   VITE_USE_MOCK_API=false
   VITE_SUPABASE_URL=http://localhost:54321
   ```

   **Option C: Production Supabase**
   ```env
   VITE_USE_MOCK_API=false
   VITE_SUPABASE_URL=https://your-project.supabase.co
   ```

4. **Start development**
   ```bash
   npm run dev
   ```

## Adding New API Endpoints

When adding new endpoints, follow this pattern in `src/lib/api.ts`:

```typescript
export const yourNewEndpoint = async (params: any) => {
  if (config.useMockApi) {
    // Return mock data
    await new Promise(resolve => setTimeout(resolve, 500));
    return { mockData: "example" };
  }

  // Real API call
  const response = await fetch(`${config.supabaseUrl}/functions/v1/your-endpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.statusText}`);
  }

  return await response.json();
};
```

Then import and use it in your components:
```typescript
import { yourNewEndpoint } from '@/lib/api';

const result = await yourNewEndpoint({ param: 'value' });
```

## Architecture

- **`src/lib/config.ts`** - Central configuration that reads environment variables
- **`src/lib/api.ts`** - API service layer with mock/real switching logic
- **`.env.example`** - Template for environment variables

## Benefits

✅ **Easy Testing** - Test UI without backend  
✅ **Faster Development** - No need to wait for backend setup  
✅ **Flexible** - Switch between mock and real with one variable  
✅ **Team Friendly** - Designers can work on UI independently  
✅ **CI/CD Ready** - Run tests with mocks, deploy with real APIs
