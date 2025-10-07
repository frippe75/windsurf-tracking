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
import { getBackendSettings, saveBackendSettings } from "@/lib/settings";

export interface Backend {
  id: string;
  name: string;
  url: string;
  enableProbe?: boolean;
  probeStatus?: "checking" | "healthy" | "offline";
}

interface BackendSelectorProps {
  backendStatus?: "checking" | "healthy" | "offline";
  onBackendsChange?: (backends: Backend[]) => void;
  probeStatuses?: Record<string, "checking" | "healthy" | "offline">;
}

const DEFAULT_BACKENDS: Backend[] = [
  { id: "local", name: "Local (8000)", url: "http://localhost:8000" },
  { id: "lab-k8s", name: "K8s Lab", url: "https://windsurf-api.tclab.org" },
  { id: "production", name: "Production", url: "https://lablebee.tclab.org" },
  { id: "custom", name: "Custom", url: "" },
];

// Legacy keys for migration
const LEGACY_STORAGE_KEY = "selected-backend";
const LEGACY_CUSTOM_BACKENDS_KEY = "custom-backends";
const LEGACY_SELECTED_BACKEND_JSON_KEY = "selected-backend-json";

export const BackendSelector = ({ backendStatus, onBackendsChange, probeStatuses }: BackendSelectorProps = {}) => {
  const [backends, setBackends] = useState<Backend[]>(DEFAULT_BACKENDS);
  const [selectedBackend, setSelectedBackend] = useState<Backend | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingBackend, setEditingBackend] = useState<Backend | null>(null);

  // Load from settings on mount (with legacy migration)
  useEffect(() => {
    const backendSettings = getBackendSettings();
    
    // Migrate legacy localStorage if exists
    const legacyId = localStorage.getItem(LEGACY_STORAGE_KEY);
    const legacyCustom = localStorage.getItem(LEGACY_CUSTOM_BACKENDS_KEY);
    const legacySnapshot = localStorage.getItem(LEGACY_SELECTED_BACKEND_JSON_KEY);
    
    if (legacyId || legacyCustom || legacySnapshot) {
      // Migrate to new settings system
      if (legacyCustom) {
        try {
          backendSettings.customBackends = JSON.parse(legacyCustom);
        } catch (e) {
          console.error("Failed to migrate custom backends", e);
        }
      }
      if (legacySnapshot) {
        try {
          backendSettings.selectedBackendSnapshot = JSON.parse(legacySnapshot);
        } catch (e) {
          console.error("Failed to migrate backend snapshot", e);
        }
      }
      if (legacyId) {
        backendSettings.selectedBackendId = legacyId;
      }
      saveBackendSettings(backendSettings);
      
      // Clean up legacy keys
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(LEGACY_CUSTOM_BACKENDS_KEY);
      localStorage.removeItem(LEGACY_SELECTED_BACKEND_JSON_KEY);
    }
    
    let allBackends = [...DEFAULT_BACKENDS, ...backendSettings.customBackends];
    
    // Try to resolve selection from ID first
    let resolved: Backend | null = null;
    if (backendSettings.selectedBackendId) {
      resolved = allBackends.find(b => b.id === backendSettings.selectedBackendId) || null;
    }

    // If not found, try to restore from snapshot
    if (!resolved && backendSettings.selectedBackendSnapshot) {
      const restored = backendSettings.selectedBackendSnapshot;
      // If missing in list, add it to backends so it persists
      if (!allBackends.find(b => b.id === restored.id)) {
        allBackends = [...allBackends, restored];
      }
      resolved = restored;
    }

    // Commit backends to state and parent
    setBackends(allBackends);
    onBackendsChange?.(allBackends);

    if (resolved) {
      setSelectedBackend(resolved);
    } else {
      // Avoid defaulting to localhost; prefer a non-local default if available
      const nonLocalDefault = DEFAULT_BACKENDS.find(b => b.id !== 'local' && b.url);
      setSelectedBackend(nonLocalDefault || DEFAULT_BACKENDS[0]);
    }
  }, [onBackendsChange]);

  // Update settings when backend changes
  useEffect(() => {
    if (selectedBackend) {
      // Save to settings system
      saveBackendSettings({
        selectedBackendId: selectedBackend.id,
        selectedBackendSnapshot: {
          id: selectedBackend.id,
          name: selectedBackend.name,
          url: selectedBackend.url,
        },
      });
      
      // Update the global config
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

    // Save custom backends to settings
    const customBackends = updatedBackends.filter(
      b => !DEFAULT_BACKENDS.find(db => db.id === b.id)
    );
    saveBackendSettings({ customBackends });

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
      saveBackendSettings({ customBackends });
      
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
                    <span className="relative flex items-center justify-center h-[8px] w-[8px]">
                      <span className="absolute inset-0 animate-ping-slow rounded-full bg-red-200 opacity-90" />
                      <span className="relative block h-[5px] w-[5px] rounded-full bg-red-400 ring-2 ring-red-500/50" />
                    </span>
                  ) : (
                    <span className="relative flex items-center justify-center h-[8px] w-[8px]">
                      <span className="absolute inset-0 animate-ping-slow rounded-full opacity-90" style={{ backgroundColor: 'hsl(142 71% 85%)' }} />
                      <span className="relative block h-[5px] w-[5px] rounded-full" style={{ backgroundColor: 'hsl(142 71% 55%)', boxShadow: '0 0 0 2px hsl(142 71% 45% / 0.5)' }} />
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
                  const externalStatus = probeStatuses?.[backend.id];
                  const status = isSelected ? backendStatus : (externalStatus ?? backend.probeStatus);
                  
                  // Only show indicator if this is the active backend OR it has enableProbe AND has a status
                  if (!isSelected && !backend.enableProbe) {
                    return <span className="block h-[8px] w-[8px]" />;
                  }
                  
                  // Show checking state for undefined status when probe is enabled
                  if (!isSelected && backend.enableProbe && !status) {
                    return <span className="block h-[5px] w-[5px] rounded-full bg-muted-foreground/30" />;
                  }
                  
                  // Show red for offline
                  if (status === "offline") {
                    return (
                      <span className="relative flex items-center justify-center h-[8px] w-[8px]">
                        <span className="absolute inset-0 animate-ping-slow rounded-full bg-red-200 opacity-90" />
                        <span className="relative block h-[5px] w-[5px] rounded-full bg-red-400 ring-2 ring-red-500/50" />
                      </span>
                    );
                  }
                  
                  // Show green for healthy
                  return (
                    <span className="relative flex items-center justify-center h-[8px] w-[8px]">
                      <span className="absolute inset-0 animate-ping-slow rounded-full opacity-90" style={{ backgroundColor: 'hsl(142 71% 85%)' }} />
                      <span className="relative block h-[5px] w-[5px] rounded-full" style={{ backgroundColor: 'hsl(142 71% 55%)', boxShadow: '0 0 0 2px hsl(142 71% 45% / 0.5)' }} />
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
                {/* Probing uses a global interval now; no per-backend interval */}
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
  let didChange = false;
  const updated = backends.map(b => {
    if (b.id !== backendId) return b;
    if (b.probeStatus === status) return b;
    didChange = true;
    return { ...b, probeStatus: status };
  });
  return didChange ? updated : backends;
};
