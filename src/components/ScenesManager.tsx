import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scan, CheckCircle, XCircle, Circle, Film, Sparkles, Tags, Filter, Flag } from "lucide-react";
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
  isGenerating?: boolean;
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
  isGenerating = false,
}: ScenesManagerProps) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");

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

  // Calculate counts for each filter
  const filterCounts = {
    all: scenes.length,
    approved: scenes.filter(s => s.quality === "good").length,
    active: scenes.filter(s => s.quality !== "bad").length,
    pending: scenes.filter(s => s.quality === "unknown").length,
    rejected: scenes.filter(s => s.quality === "bad").length,
    withMetadata: scenes.filter(s => s.quality !== "bad" && s.metadata && Object.keys(s.metadata).length > 0).length,
    withoutMetadata: scenes.filter(s => s.quality !== "bad" && (!s.metadata || Object.keys(s.metadata).length === 0)).length,
  };

  const filteredScenes = scenes.filter((scene) => {
    let result = false;
    switch (filter) {
      case "approved":
        result = scene.quality === "good";
        break;
      case "active":
        result = scene.quality !== "bad"; // good or unknown
        break;
      case "rejected":
        result = scene.quality === "bad";
        break;
      case "pending":
        result = scene.quality === "unknown";
        break;
      case "with-metadata":
        result = scene.quality !== "bad" && scene.metadata && Object.keys(scene.metadata).length > 0;
        break;
      case "without-metadata":
        result = scene.quality !== "bad" && (!scene.metadata || Object.keys(scene.metadata).length === 0);
        break;
      case "all":
      default:
        result = true;
    }
    console.log(`🔍 Filter="${filter}" Scene ${scene.id} quality="${scene.quality}" → ${result ? "SHOW" : "HIDE"}`);
    return result;
  });

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
          disabled={isGenerating}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {isGenerating ? "Generating..." : "Generate Metadata"}
        </Button>
        
        {/* Filter Dropdown */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter scenes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <div className="flex items-center gap-2">
                  <span>All Scenes</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.all}</Badge>
                </div>
              </SelectItem>
              <SelectItem value="approved">
                <div className="flex items-center gap-2">
                  <span>Approved Only</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.approved}</Badge>
                </div>
              </SelectItem>
              <SelectItem value="active">
                <div className="flex items-center gap-2">
                  <span>Active Scenes</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.active}</Badge>
                </div>
              </SelectItem>
              <SelectItem value="pending">
                <div className="flex items-center gap-2">
                  <span>Pending Review</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.pending}</Badge>
                </div>
              </SelectItem>
              <SelectItem value="rejected">
                <div className="flex items-center gap-2">
                  <span>Rejected Only</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.rejected}</Badge>
                </div>
              </SelectItem>
              <SelectItem value="with-metadata">
                <div className="flex items-center gap-2">
                  <span>With Metadata</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.withMetadata}</Badge>
                </div>
              </SelectItem>
              <SelectItem value="without-metadata">
                <div className="flex items-center gap-2">
                  <span>Without Metadata</span>
                  <Badge variant="secondary" className="text-xs text-muted-foreground bg-muted">{filterCounts.withoutMetadata}</Badge>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
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
          ) : filteredScenes.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground ml-4">
              <Filter className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No scenes match the current filter.</p>
            </div>
          ) : (
            filteredScenes.map((scene, index) => {
              const isBad = scene.quality === "bad";
              const isActive = isSceneActive(scene);
              return (
                <div
                  key={scene.id}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer transition-all ml-4 relative ${
                    isBad 
                      ? "opacity-50 bg-muted/20 border-destructive/20 hover:opacity-60" 
                      : selectedScene?.id === scene.id
                      ? "bg-primary/10 border-primary"
                      : isActive && !selectedScene
                      ? "bg-primary/5 border-l-4 border-l-primary border-r border-t border-b border-border"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  }`}
                  onClick={() => !isBad && handleSceneClick(scene)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isActive && !selectedScene && (
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                      )}
                      <Badge variant="secondary" className="text-xs">
                        Scene {index + 1}
                      </Badge>
                      {scene.metadata && Object.keys(scene.metadata).length > 0 && (
                        <Tags className="h-3 w-3 text-[hsl(var(--sail-purple))]" />
                      )}
                    </div>
                    <div className="flex gap-1 items-center">
                      {scene.metadata && Object.keys(scene.metadata).length > 0 && (
                        <Flag className="h-4 w-4 mr-1" fill="hsl(var(--muted-foreground))" color="hsl(var(--muted-foreground))" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSceneQualityChange(scene.id, "good");
                        }}
                      >
                        <CheckCircle className={`h-4 w-4 ${scene.quality === "good" ? "text-[hsl(var(--sail-green))]" : "text-muted-foreground/40"}`} />
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
                        <XCircle className={`h-4 w-4 ${scene.quality === "bad" ? "text-destructive" : "text-muted-foreground/40"}`} />
                      </Button>
                    </div>
                  </div>
                  {!isBad && (
                    <div className="text-xs text-muted-foreground">
                      {scene.endFrame - scene.startFrame + 1} frames
                    </div>
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
