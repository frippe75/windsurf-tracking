import { useState, useEffect } from "react";
import { Check, ChevronDown, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface Backend {
  id: string;
  name: string;
  url: string;
  enableProbe?: boolean;
  probeInterval?: number; // in seconds
  probeStatus?: "checking" | "healthy" | "offline";
}

interface BackendSelectorProps {
  backendStatus?: "checking" | "healthy" | "offline";
  onBackendsChange?: (backends: Backend[]) => void;
}

const DEFAULT_BACKENDS: Backend[] = [
  { id: "local", name: "Local (8000)", url: "http://localhost:8000" },
  { id: "lab-k8s", name: "K8s Lab", url: "https://windsurf-api.tclab.org" },
  { id: "production", name: "Production", url: "https://lablebee.tclab.org" },
  { id: "custom", name: "Custom", url: "" },
];

const STORAGE_KEY = "selected-backend";
const CUSTOM_BACKENDS_KEY = "custom-backends";

export const BackendSelector = ({ backendStatus, onBackendsChange }: BackendSelectorProps = {}) => {
  const [backends, setBackends] = useState<Backend[]>(DEFAULT_BACKENDS);
  const [selectedBackend, setSelectedBackend] = useState<Backend | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingBackend, setEditingBackend] = useState<Backend | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const storedBackendId = localStorage.getItem(STORAGE_KEY);
    const storedCustomBackends = localStorage.getItem(CUSTOM_BACKENDS_KEY);
    
    let allBackends = [...DEFAULT_BACKENDS];
    if (storedCustomBackends) {
      try {
        const customBackends = JSON.parse(storedCustomBackends);
        allBackends = [...DEFAULT_BACKENDS, ...customBackends];
      } catch (e) {
        console.error("Failed to parse custom backends", e);
      }
    }
    
    setBackends(allBackends);
    onBackendsChange?.(allBackends);
    
    if (storedBackendId) {
      const backend = allBackends.find(b => b.id === storedBackendId);
      if (backend) {
        setSelectedBackend(backend);
      }
    } else {
      // Default to local
      setSelectedBackend(DEFAULT_BACKENDS[0]);
    }
  }, [onBackendsChange]);

  // Update config when backend changes
  useEffect(() => {
    if (selectedBackend) {
      // Store in localStorage
      localStorage.setItem(STORAGE_KEY, selectedBackend.id);
      
      // Update the global config by reloading
      // This is a simple approach - in production you might use a state manager
      if (typeof window !== 'undefined') {
        (window as any).__LOVABLE_BACKEND_URL__ = selectedBackend.url;
      }
    }
  }, [selectedBackend]);

  const handleSelectBackend = (backend: Backend) => {
    setSelectedBackend(backend);
  };

  const handleEditBackend = (backend: Backend) => {
    setEditingBackend({ ...backend });
    setIsEditDialogOpen(true);
  };

  const handleSaveBackend = () => {
    if (!editingBackend || !editingBackend.name || !editingBackend.url) {
      return;
    }

    const updatedBackends = backends.map(b => 
      b.id === editingBackend.id ? editingBackend : b
    );

    // If it's a custom backend (not in defaults), save to localStorage
    const customBackends = updatedBackends.filter(
      b => !DEFAULT_BACKENDS.find(db => db.id === b.id)
    );
    localStorage.setItem(CUSTOM_BACKENDS_KEY, JSON.stringify(customBackends));

    setBackends(updatedBackends);
    onBackendsChange?.(updatedBackends);
    
    if (selectedBackend?.id === editingBackend.id) {
      setSelectedBackend(editingBackend);
    }
    
    setIsEditDialogOpen(false);
  };

  const handleAddBackend = () => {
    const newBackend: Backend = {
      id: `custom-${Date.now()}`,
      name: "New Backend",
      url: "http://localhost:8000",
      enableProbe: false,
      probeInterval: 30,
    };
    setEditingBackend(newBackend);
    setIsEditDialogOpen(true);
  };

  const handleSaveNewBackend = () => {
    if (!editingBackend || !editingBackend.name || !editingBackend.url) {
      return;
    }

    const isNewBackend = !backends.find(b => b.id === editingBackend.id);
    
    if (isNewBackend) {
      const updatedBackends = [...backends, editingBackend];
      setBackends(updatedBackends);
      onBackendsChange?.(updatedBackends);
      
      const customBackends = updatedBackends.filter(
        b => !DEFAULT_BACKENDS.find(db => db.id === b.id)
      );
      localStorage.setItem(CUSTOM_BACKENDS_KEY, JSON.stringify(customBackends));
      
      setSelectedBackend(editingBackend);
    } else {
      handleSaveBackend();
      return;
    }
    
    setIsEditDialogOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-[240px] h-auto min-h-[40px] py-2 justify-between">
            {selectedBackend ? (
              <div className="grid grid-cols-[16px,1fr] grid-rows-2 gap-x-2 w-full text-left">
                <div className="col-start-1 row-start-1 row-span-2 flex items-start justify-center pt-0.5">
                  {backendStatus === "offline" ? (
                    <span className="relative flex items-center justify-center h-[9px] w-[9px]">
                      <span className="absolute inset-0 animate-ping-slow rounded-full bg-red-200 opacity-90" />
                      <span className="relative block h-1.5 w-1.5 rounded-full bg-red-400 ring-2 ring-red-500/50" />
                    </span>
                  ) : (
                    <span className="relative flex items-center justify-center h-[9px] w-[9px]">
                      <span className="absolute inset-0 animate-ping-slow rounded-full opacity-90" style={{ backgroundColor: 'hsl(142 71% 85%)' }} />
                      <span className="relative block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'hsl(142 71% 55%)', boxShadow: '0 0 0 2px hsl(142 71% 45% / 0.5)' }} />
                    </span>
                  )}
                </div>
                <span className="col-start-2 row-start-1 font-bold leading-tight">{selectedBackend.name}</span>
                <span className="col-start-2 row-start-2 text-xs text-muted-foreground leading-tight">{selectedBackend.url}</span>
              </div>
            ) : (
              <span>Select backend</span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[280px]">
          {backends.map((backend) => (
            <DropdownMenuItem
              key={backend.id}
              className="grid grid-cols-[16px,1fr,auto,auto] grid-rows-2 gap-x-2 items-center p-2 cursor-pointer group"
              onClick={() => handleSelectBackend(backend)}
            >
              <div className="col-start-1 row-start-1 row-span-2 flex items-start justify-center pt-1">
                {(() => {
                  const isSelected = selectedBackend?.id === backend.id;
                  const status = isSelected ? backendStatus : backend.probeStatus;
                  
                  // Only show indicator if this is the active backend OR it has enableProbe AND has a status
                  if (!isSelected && !backend.enableProbe) {
                    return <span className="block h-[9px] w-[9px]" />;
                  }
                  
                  // Show checking state for undefined status when probe is enabled
                  if (!isSelected && backend.enableProbe && !status) {
                    return <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />;
                  }
                  
                  // Show red for offline
                  if (status === "offline") {
                    return (
                      <span className="relative flex items-center justify-center h-[9px] w-[9px]">
                        <span className="absolute inset-0 animate-ping-slow rounded-full bg-red-200 opacity-90" />
                        <span className="relative block h-1.5 w-1.5 rounded-full bg-red-400 ring-2 ring-red-500/50" />
                      </span>
                    );
                  }
                  
                  // Show green for healthy
                  return (
                    <span className="relative flex items-center justify-center h-[9px] w-[9px]">
                      <span className="absolute inset-0 animate-ping-slow rounded-full opacity-90" style={{ backgroundColor: 'hsl(142 71% 85%)' }} />
                      <span className="relative block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'hsl(142 71% 55%)', boxShadow: '0 0 0 2px hsl(142 71% 45% / 0.5)' }} />
                    </span>
                  );
                })()}
              </div>
              <span className="col-start-2 row-start-1 font-bold leading-tight">{backend.name}</span>
              <span className="col-start-2 row-start-2 text-xs text-muted-foreground leading-tight">{backend.url}</span>
              <button
                className="col-start-3 row-start-1 row-span-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditBackend(backend);
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              {selectedBackend?.id === backend.id && (
                <Check className="col-start-4 row-start-1 row-span-2 h-4 w-4" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={handleAddBackend}
          >
            <Plus className="h-4 w-4" />
            <span>Add New Backend</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {backends.find(b => b.id === editingBackend?.id) ? "Edit" : "Add"} Backend
            </DialogTitle>
            <DialogDescription>
              Configure backend URL for API connections
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={editingBackend?.name || ""}
                onChange={(e) => setEditingBackend(prev => 
                  prev ? { ...prev, name: e.target.value } : null
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                value={editingBackend?.url || ""}
                onChange={(e) => setEditingBackend(prev => 
                  prev ? { ...prev, url: e.target.value } : null
                )}
                placeholder="http://localhost:8000"
              />
            </div>
            <div className="flex items-start space-x-2 pt-2">
              <Checkbox 
                id="enableProbe"
                checked={editingBackend?.enableProbe ?? false}
                onCheckedChange={(checked) => 
                  setEditingBackend(prev => 
                    prev ? { ...prev, enableProbe: checked as boolean } : null
                  )
                }
              />
              <div className="grid gap-2 flex-1">
                <Label htmlFor="enableProbe" className="text-sm font-normal cursor-pointer leading-tight">
                  Monitor health status (even when inactive)
                </Label>
                {editingBackend?.enableProbe && (
                  <div className="grid gap-2">
                    <Label htmlFor="probeInterval" className="text-xs">
                      Probe interval (seconds)
                    </Label>
                    <Input
                      id="probeInterval"
                      type="number"
                      min="5"
                      max="300"
                      value={editingBackend?.probeInterval ?? 30}
                      onChange={(e) => setEditingBackend(prev => 
                        prev ? { ...prev, probeInterval: parseInt(e.target.value) || 30 } : null
                      )}
                      className="w-24"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNewBackend}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Helper to get all backends that should be probed
export const getProbeBackends = (backends: Backend[], activeBackendId: string) => {
  return backends.filter(b => 
    b.id === activeBackendId || b.enableProbe === true
  );
};

// Helper to update probe status for a specific backend
export const updateBackendProbeStatus = (
  backends: Backend[], 
  backendId: string, 
  status: "checking" | "healthy" | "offline"
): Backend[] => {
  return backends.map(b => 
    b.id === backendId ? { ...b, probeStatus: status } : b
  );
};
