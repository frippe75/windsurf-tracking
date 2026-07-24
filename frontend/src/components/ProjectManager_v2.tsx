import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Project } from "@/types/project";
import { ManagedVideo } from "@/types/video";
import { MetaField } from "@/types/annotation";
import { MetadataSchemaCard } from "@/components/MetadataSchemaCard";
import { DatasetVersionsCard } from "@/components/DatasetVersionsCard";
import {
  FolderOpen,
  Plus,
  Video,
  Layers,
  Calendar,
  Download,
  CheckSquare,
  Square,
  Trash2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VideoListItem } from "@/components/VideoListItem";
import { ListKeyboardHint } from "@/components/ListKeyboardHint";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";

interface ProjectManager_v2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProject: Project | null;
  videos: ManagedVideo[];
  currentVideoId: string | null;
  onOpenAddResources: () => void;
  onOpenProjectSwitcher: () => void;
  onLoadVideo: (videoId: string) => void;
  onRemoveVideo: (videoId: string) => void;
  onRenameProject: (projectId: string, newName: string) => void;
  /** Persist the dataset description (the auto-draft's real context). */
  onUpdateDescription?: (projectId: string, description: string) => void;
  /** Export the active project as a YOLO dataset (project-scoped action). */
  onExport?: () => void;
  /** The dataset's metadata schema + editor. */
  metadataSchema?: MetaField[];
  onUpdateSchema?: (fields: MetaField[]) => void;
  classNames?: string[];
}

export function ProjectManager_v2({
  open,
  onOpenChange,
  activeProject,
  videos,
  currentVideoId,
  onOpenAddResources,
  onOpenProjectSwitcher,
  onLoadVideo,
  onRemoveVideo,
  onRenameProject,
  onUpdateDescription,
  onExport,
  metadataSchema = [],
  onUpdateSchema,
  classNames = [],
}: ProjectManager_v2Props) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const saveDescription = () => {
    if (activeProject && descDraft != null && descDraft !== (activeProject.description ?? "")) {
      onUpdateDescription?.(activeProject.id, descDraft.trim());
    }
    setDescDraft(null);
  };
  const startEditingName = () => {
    if (activeProject) {
      console.log('Starting edit with project name:', activeProject.name);
      setEditNameValue(activeProject.name);
      setIsEditingName(true);
    }
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setEditNameValue("");
  };

  const saveNameEdit = () => {
    const trimmed = editNameValue.trim();
    if (trimmed && activeProject && trimmed !== activeProject.name) {
      onRenameProject(activeProject.id, trimmed);
    }
    setIsEditingName(false);
    setEditNameValue("");
  };


  const projectVideos = activeProject
    ? videos.filter(v => activeProject.videoIds?.includes(v.id))
    : [];

  // Keyboard navigation + multi-select for the project's video list. Enter
  // loads the focused (ready) video — the list's primary per-item action.
  const nav = useListKeyboardNav({
    itemIds: projectVideos.map((v) => v.id),
    enabled: open,
    onActivate: (id) => {
      if (projectVideos.find((v) => v.id === id)?.status === "ready") {
        onLoadVideo(id);
      }
    },
  });

  const removeSelected = () => {
    nav.selectedIds.forEach((id) => onRemoveVideo(id));
    nav.clearSelection();
  };

  const videoCount = projectVideos.length;
  const annotationCount = activeProject?.annotations?.length || 0;
  const classCount = activeProject?.classes?.length || 0;
  const instanceCount = activeProject?.instances?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] p-0" onKeyDown={nav.onKeyDown}>
        <DialogTitle className="sr-only">Project Manager</DialogTitle>
        {activeProject ? (
          <>
            <div className="p-6 border-b border-border space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditingName ? (
                      <Input
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onBlur={saveNameEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveNameEdit();
                          if (e.key === "Escape") cancelEditingName();
                        }}
                        className="h-auto py-0 px-0 !text-lg font-semibold border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                        autoFocus
                      />
                    ) : (
                      <h2
                        className="text-lg font-semibold cursor-pointer hover:underline transition-all"
                        onClick={startEditingName}
                        title="Click to rename"
                      >
                        {activeProject.name}
                      </h2>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Active Project
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {onExport && (
                    <Button
                      onClick={onExport}
                      variant="outline"
                      data-testid="export-button"
                      disabled={!currentVideoId}
                      title={currentVideoId ? "Export this project as a YOLO dataset" : "Load a video to export"}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                  )}
                  <Button onClick={onOpenProjectSwitcher} variant="outline">
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Switch Project
                  </Button>
                </div>
              </div>
              {/* Full-width description row (was cramped inside the header, next to the buttons) */}
              <Textarea
                value={descDraft ?? activeProject.description ?? ""}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={saveDescription}
                placeholder="Describe this dataset's purpose (domain, subjects, what it's for) — the auto-draft reads this to propose a relevant metadata schema."
                className="w-full resize-none min-h-[4rem] md:min-h-[6rem] text-xs md:text-sm"
              />
            </div>

            {/* Stack the two columns on mobile (they were laid out side-by-side, pushing the right
                one off a narrow screen); side-by-side from md up. Scroll the whole area on mobile. */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 p-4 gap-4 overflow-y-auto md:overflow-hidden">
              {/* Left: Statistics — narrower than the video list */}
              <div className="flex-1 md:flex-[2] flex flex-col min-w-0 min-h-[45vh] md:min-h-0 border border-border rounded-lg bg-card overflow-hidden">
                <div className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">Statistics</h3>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Video className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Videos</span>
                    </div>
                    <p className="text-3xl font-bold">{videoCount}</p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Classes</span>
                    </div>
                    <p className="text-3xl font-bold">{classCount}</p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Instances</span>
                    </div>
                    <p className="text-3xl font-bold">{instanceCount}</p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Annotations</span>
                    </div>
                    <p className="text-3xl font-bold">{annotationCount}</p>
                  </Card>
                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <Calendar className="h-3 w-3" />
                      <span>
                        Last modified {formatDistanceToNow(activeProject.lastModified, { addSuffix: true })}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{activeProject.id}</span>
                  </div>
                  {onUpdateSchema && (
                    <div className="pt-4 border-t border-border">
                      <MetadataSchemaCard
                        schema={metadataSchema}
                        onUpdate={onUpdateSchema}
                        projectName={activeProject.name}
                        description={activeProject.description}
                        classNames={classNames}
                      />
                    </div>
                  )}
                  <div className="pt-4 border-t border-border">
                    <DatasetVersionsCard videoId={currentVideoId} />
                  </div>
                  </div>
                </ScrollArea>
              </div>

              {/* Right: Videos — wider so active-video switching is comfortable */}
              <div className="flex-1 md:flex-[3] flex flex-col min-w-0 min-h-[45vh] md:min-h-0 border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex items-center justify-between gap-2 p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">Videos</h3>
                  {projectVideos.length > 0 && (
                    <div className="flex items-center gap-1">
                      {nav.selectedCount > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8"
                          onClick={removeSelected}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove {nav.selectedCount}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={nav.selectAll}
                      >
                        <CheckSquare className="h-4 w-4 mr-1" />
                        Select all
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={nav.clearSelection}
                        disabled={nav.selectedCount === 0}
                      >
                        <Square className="h-4 w-4 mr-1" />
                        Deselect all
                      </Button>
                      <ListKeyboardHint enterLabel="Load focused video" />
                    </div>
                  )}
                </div>

                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2" ref={nav.containerRef}>
                    {projectVideos.map((video, i) => (
                      <div key={video.id} data-nav-index={i}>
                        <VideoListItem
                          video={video}
                          isActive={video.id === currentVideoId}
                          isSelected={nav.isSelected(video.id)}
                          isFocused={nav.isFocused(i)}
                          showThumbnail
                          showProgress
                          showYoutubeIcon={false}
                          onClick={(id) => { if (video.status === "ready") onLoadVideo(id); }}
                          onLoad={onLoadVideo}
                          onDelete={onRemoveVideo}
                          loadButtonTitle="Set as active video"
                          deleteButtonTitle="Remove from project"
                        />
                      </div>
                    ))}

                    {projectVideos.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <Video className="h-12 w-12 mx-auto mb-4 opacity-20" />
                        <p>No videos in this project</p>
                        <p className="text-sm">Add videos to start annotating</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                
                {/* Add button at bottom */}
                <div className="p-3 border-t border-border">
                  <Button onClick={onOpenAddResources} className="w-full" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Resources
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">No Active Project</h2>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground bg-card">
              <FolderOpen className="h-16 w-16 mb-4 opacity-20" />
              <p className="mb-2">No project is currently active</p>
              <p className="text-sm mb-6">Create or open a project to get started</p>
              <Button onClick={onOpenProjectSwitcher}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Open Project
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
