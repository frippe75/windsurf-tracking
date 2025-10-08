import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Project } from "@/types/project";
import { 
  FolderOpen, 
  Plus, 
  Trash2, 
  Video, 
  CheckCircle2,
  Calendar,
  Layers
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProjectSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectCreate: (name: string) => void;
  onProjectDelete: (projectId: string) => void;
}

export function ProjectSwitcher({
  open,
  onOpenChange,
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectCreate,
  onProjectDelete,
}: ProjectSwitcherProps) {
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = () => {
    if (newProjectName.trim()) {
      onProjectCreate(newProjectName.trim());
      setNewProjectName("");
      setIsCreating(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    onProjectSelect(projectId);
    onOpenChange(false);
  };

  const sortedProjects = [...projects].sort((a, b) => {
    // Active project first
    if (a.id === activeProjectId) return -1;
    if (b.id === activeProjectId) return 1;
    // Then by last modified
    return b.lastModified - a.lastModified;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[70vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Projects</DialogTitle>
            <Button
              onClick={() => setIsCreating(!isCreating)}
              size="sm"
              variant={isCreating ? "ghost" : "default"}
            >
              <Plus className="h-4 w-4 mr-2" />
              {isCreating ? "Cancel" : "New Project"}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4">
          {/* Create New Project */}
          {isCreating && (
            <Card className="p-4 border-primary">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
                <Button onClick={handleCreate} disabled={!newProjectName.trim()}>
                  Create
                </Button>
              </div>
            </Card>
          )}

          {/* Projects List */}
          <ScrollArea className="flex-1">
            <div className="space-y-3">
              {sortedProjects.map((project) => {
                const isActive = project.id === activeProjectId;
                const videoCount = project.videoIds?.length || 0;
                const annotationCount = project.annotations?.length || 0;
                const classCount = project.classes?.length || 0;

                return (
                  <Card
                    key={project.id}
                    className={`p-4 cursor-pointer transition-all ${
                      isActive 
                        ? 'border-green-500 bg-green-500/5' 
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => !isActive && handleSelectProject(project.id)}
                  >
                    <div className="flex items-start gap-4">
                      {/* Project Icon */}
                      <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${
                        isActive ? 'bg-green-500/20' : 'bg-muted'
                      }`}>
                        <FolderOpen className={`h-6 w-6 ${
                          isActive ? 'text-green-500' : 'text-muted-foreground'
                        }`} />
                      </div>

                      {/* Project Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold truncate">{project.name}</h3>
                          {isActive && (
                            <Badge variant="default" className="bg-green-500">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          )}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                          <div className="flex items-center gap-1">
                            <Video className="h-3 w-3" />
                            <span>{videoCount} video{videoCount !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            <span>{classCount} class{classCount !== 1 ? 'es' : ''}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            <span>{annotationCount} annotation{annotationCount !== 1 ? 's' : ''}</span>
                          </div>
                        </div>

                        {/* Last Modified */}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          <span>
                            Last modified {formatDistanceToNow(project.lastModified, { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            onProjectDelete(project.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}

              {projects.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No projects yet</p>
                  <p className="text-sm">Create your first project to get started</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
