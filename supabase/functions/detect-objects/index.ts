import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PREDEFINED_CLASSES = [
  { name: "Sail", color: "#ef4444", colorName: "red" },
  { name: "Boat", color: "#3b82f6", colorName: "blue" },
  { name: "Person", color: "#10b981", colorName: "green" },
  { name: "Buoy", color: "#f59e0b", colorName: "amber" },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { frameWidth, frameHeight } = await req.json();
    
    // Generate 3-4 random detections
    const numDetections = Math.floor(Math.random() * 2) + 3; // 3 or 4
    const detections = [];
    
    for (let i = 0; i < numDetections; i++) {
      const classInfo = PREDEFINED_CLASSES[i % PREDEFINED_CLASSES.length];
      
      // Random bbox size (10-40% of frame)
      const width = Math.floor(frameWidth * (0.1 + Math.random() * 0.3));
      const height = Math.floor(frameHeight * (0.1 + Math.random() * 0.3));
      
      // Random position (ensure bbox stays in frame)
      const x = Math.floor(Math.random() * (frameWidth - width));
      const y = Math.floor(Math.random() * (frameHeight - height));
      
      // Generate random polygon points around the bbox
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
    
    console.log(`Generated ${numDetections} mock detections`);
    
    return new Response(JSON.stringify({ detections }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in detect-objects:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
