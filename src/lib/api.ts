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

  // Real API call
  const response = await fetch(`${config.supabaseUrl}/functions/v1/detect-objects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ frameWidth, frameHeight }),
  });

  if (!response.ok) {
    throw new Error(`Detection failed: ${response.statusText}`);
  }

  return await response.json();
};

// Add more API functions here as needed
// export const anotherEndpoint = async (...) => { ... }
