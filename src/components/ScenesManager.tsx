import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Scan, CheckCircle, XCircle, Circle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Scene {
  id: string;
  startFrame: number;
  endFrame: number;
  quality: "good" | "bad" | "unknown";
}

interface ScenesManagerProps {
  scenes: Scene[];
  currentFrame: number;
  onDetectScenes: () => void;
  onSceneSelect: (scene: Scene) => void;
  onSceneQualityChange: (sceneId: string, quality: "good" | "bad" | "unknown") => void;
  isDetecting?: boolean;
}

export function ScenesManager({
  scenes,
  currentFrame,
  onDetectScenes,
  onSceneSelect,
  onSceneQualityChange,
  isDetecting = false,
}: ScenesManagerProps) {
  const { toast } = useToast();

  const handleSceneClick = (scene: Scene) => {
    onSceneSelect(scene);
    toast({
      title: "Scene selected",
      description: `Frames ${scene.startFrame} - ${scene.endFrame}`,
    });
  };

  const getQualityIcon = (quality: string) => {
    switch (quality) {
      case "good":
        return <CheckCircle className="h-4 w-4 text-[hsl(var(--sail-green))]" />;
      case "bad":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isSceneActive = (scene: Scene) => {
    return currentFrame >= scene.startFrame && currentFrame <= scene.endFrame;
  };

  return (
    <Card className="p-4 bg-card border-border h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Scene Detection</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onDetectScenes}
          disabled={isDetecting}
        >
          <Scan className="h-4 w-4 mr-2" />
          {isDetecting ? "Detecting..." : "Detect Scenes"}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {scenes.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <Scan className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No scenes detected yet.</p>
            <p className="text-xs mt-1">Click "Detect Scenes" to analyze the video.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {scenes.map((scene, index) => (
              <div
                key={scene.id}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  isSceneActive(scene)
                    ? "bg-primary/10 border-primary"
                    : "bg-muted/30 border-border hover:bg-muted/50"
                }`}
                onClick={() => handleSceneClick(scene)}
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary" className="text-xs">
                    Scene {index + 1}
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSceneQualityChange(scene.id, "good");
                      }}
                    >
                      {getQualityIcon(scene.quality === "good" ? "good" : "unknown")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSceneQualityChange(scene.id, "bad");
                      }}
                    >
                      {getQualityIcon(scene.quality === "bad" ? "bad" : "unknown")}
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Frames {scene.startFrame} - {scene.endFrame}
                  <span className="ml-2">({scene.endFrame - scene.startFrame + 1} frames)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}
