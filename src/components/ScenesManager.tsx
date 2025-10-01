import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Scan, CheckCircle, XCircle, Circle, Film, Sparkles, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Scene {
  id: string;
  startFrame: number;
  endFrame: number;
  quality: "good" | "bad" | "unknown";
  metadata?: Record<string, string>;
}

interface ScenesManagerProps {
  scenes: Scene[];
  currentFrame: number;
  totalFrames: number;
  selectedScene: Scene | null;
  onDetectScenes: () => void;
  onSceneSelect: (scene: Scene | null) => void;
  onSceneQualityChange: (sceneId: string, quality: "good" | "bad" | "unknown") => void;
  onGenerateMetadata: () => void;
  isDetecting?: boolean;
}

export function ScenesManager({
  scenes,
  currentFrame,
  totalFrames,
  selectedScene,
  onDetectScenes,
  onSceneSelect,
  onSceneQualityChange,
  onGenerateMetadata,
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

  const handleFullVideoClick = () => {
    onSceneSelect(null);
    toast({
      title: "Full video view",
      description: `Showing all ${totalFrames} frames`,
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
    <Card className="p-4 bg-card border-border h-full flex flex-col max-h-[600px]">
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
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
        <Button
          variant="default"
          size="sm"
          className="w-full"
          onClick={onGenerateMetadata}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate Metadata
        </Button>
      </div>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-[calc(100vh-300px)] pr-2">
          <div className="space-y-2">
          {/* Full Video Option */}
          <div
            className={`px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
              !selectedScene
                ? "bg-primary/10 border-primary"
                : "bg-muted/30 border-border hover:bg-muted/50"
            }`}
            onClick={handleFullVideoClick}
          >
            <div className="flex items-center gap-2 mb-1">
              <Film className="h-4 w-4" />
              <Badge variant="secondary" className="text-xs">Full Video</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {totalFrames} frames
            </div>
          </div>

          {/* Scenes List */}
          {scenes.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground ml-4">
              <Scan className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No scenes detected yet.</p>
            </div>
          ) : (
            scenes.map((scene, index) => {
              const isBad = scene.quality === "bad";
              return (
                <div
                  key={scene.id}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer transition-all ml-4 ${
                    isBad 
                      ? "opacity-50 bg-muted/20 border-destructive/20 hover:opacity-60" 
                      : selectedScene?.id === scene.id
                      ? "bg-primary/10 border-primary"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  }`}
                  onClick={() => !isBad && handleSceneClick(scene)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        Scene {index + 1}
                      </Badge>
                      {scene.metadata && Object.keys(scene.metadata).length > 0 && (
                        <Database className="h-3 w-3 text-[hsl(var(--sail-purple))]" />
                      )}
                    </div>
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
                  {!isBad && (
                    <>
                      <div className="text-xs text-muted-foreground mb-2">
                        {scene.endFrame - scene.startFrame + 1} frames
                      </div>
                      {scene.metadata && Object.keys(scene.metadata).length > 0 && (
                        <div className="mt-2 p-2 bg-muted/40 rounded text-xs space-y-1">
                          {Object.entries(scene.metadata).slice(0, 2).map(([key, value]) => (
                            <div key={key} className="flex gap-1">
                              <span className="font-medium">{key}:</span>
                              <span className="text-muted-foreground truncate">{value}</span>
                            </div>
                          ))}
                          {Object.keys(scene.metadata).length > 2 && (
                            <div className="text-muted-foreground italic">
                              +{Object.keys(scene.metadata).length - 2} more
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
    </Card>
  );
}
