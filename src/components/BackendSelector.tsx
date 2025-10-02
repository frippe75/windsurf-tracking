import { useState, useEffect } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
}

interface BackendSelectorProps {
  backendStatus?: "checking" | "healthy" | "offline";
}

const DEFAULT_BACKENDS: Backend[] = [
  { id: "local", name: "Local (8000)", url: "http://localhost:8000" },
  { id: "lab-k8s", name: "K8s Lab", url: "https://windsurf-api.tclab.org" },
  { id: "production", name: "Production", url: "https://lablebee.tclab.org" },
  { id: "custom", name: "Custom", url: "" },
];

const STORAGE_KEY = "selected-backend";
const CUSTOM_BACKENDS_KEY = "custom-backends";

export const BackendSelector = ({ backendStatus }: BackendSelectorProps = {}) => {
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
    
    if (storedBackendId) {
      const backend = allBackends.find(b => b.id === storedBackendId);
      if (backend) {
        setSelectedBackend(backend);
      }
    } else {
      // Default to local
      setSelectedBackend(DEFAULT_BACKENDS[0]);
    }
  }, []);

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
      <div className="flex items-center gap-2">
        <Select
          value={selectedBackend?.id || ""}
          onValueChange={(value) => {
            const backend = backends.find(b => b.id === value);
            if (backend) handleSelectBackend(backend);
          }}
        >
          <SelectTrigger className="w-[280px] h-auto min-h-[40px] py-2">
            {selectedBackend ? (
              <div className="grid grid-cols-[16px,1fr] grid-rows-2 gap-x-2 w-full text-left">
                <div className="col-start-1 row-start-1 row-span-2 flex items-start justify-center pt-0.5">
                  {backendStatus === "offline" ? (
                    <span className="block h-3 w-3 rounded-full bg-red-500 ring-2 ring-red-600/50" />
                  ) : (
                    <span className="block h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-emerald-600/50" />
                  )}
                </div>
                <span className="col-start-2 row-start-1 font-bold leading-tight">{selectedBackend.name}</span>
                <span className="col-start-2 row-start-2 text-xs text-muted-foreground leading-tight">{selectedBackend.url}</span>
              </div>
            ) : (
              <SelectValue placeholder="Select backend" />
            )}
          </SelectTrigger>
          <SelectContent>
            {backends.map((backend) => (
              <SelectItem key={backend.id} value={backend.id} className="[&>span:first-child]:hidden !pl-2">
                <span className="inline-grid grid-cols-[16px,1fr] grid-rows-2 gap-x-2 items-start w-full">
                  <span className="col-start-1 row-start-1 row-span-2 flex items-start justify-center">
                    {selectedBackend?.id === backend.id ? (
                      backendStatus === "offline" ? (
                        <span className="block h-3 w-3 rounded-full bg-red-500 ring-2 ring-red-600/50" />
                      ) : (
                        <span className="block h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-emerald-600/50" />
                      )
                    ) : (
                      <span className="block h-3 w-3" />
                    )}
                  </span>
                  <span className="col-start-2 row-start-1 font-bold leading-tight">{backend.name}</span>
                  <span className="col-start-2 row-start-2 text-xs text-muted-foreground leading-tight">{backend.url}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleAddBackend}
          title="Add custom backend"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        
        {selectedBackend && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => handleEditBackend(selectedBackend)}
            title="Edit current backend"
          >
            Edit
          </Button>
        )}
      </div>

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
