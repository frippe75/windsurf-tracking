import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Check, X } from "lucide-react";
import { useState } from "react";

interface MetadataEditorProps {
  metadata: Record<string, string>;
  onSave: (metadata: Record<string, string>) => void;
  onCancel: () => void;
}

export function MetadataEditor({ metadata, onSave, onCancel }: MetadataEditorProps) {
  const [editedMetadata, setEditedMetadata] = useState<Record<string, string>>(metadata);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const handleAddField = () => {
    if (newKey.trim() && newValue.trim()) {
      setEditedMetadata({
        ...editedMetadata,
        [newKey.trim()]: newValue.trim(),
      });
      setNewKey("");
      setNewValue("");
    }
  };

  const handleRemoveField = (key: string) => {
    const { [key]: _, ...rest } = editedMetadata;
    setEditedMetadata(rest);
  };

  const handleUpdateField = (key: string, value: string) => {
    setEditedMetadata({
      ...editedMetadata,
      [key]: value,
    });
  };

  return (
    <Card className="p-3 bg-muted/20 border-muted">
      <div className="text-xs font-semibold mb-2">Metadata</div>
      
      {/* Existing fields */}
      <div className="space-y-2 mb-2">
        {Object.entries(editedMetadata).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <Input
              value={key}
              disabled
              className="h-7 text-xs w-24 bg-muted/50"
            />
            <Input
              value={value}
              onChange={(e) => handleUpdateField(key, e.target.value)}
              className="h-7 text-xs flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveField(key)}
              className="h-7 w-7 p-0 text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add new field */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Key (e.g., brand)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddField();
            }}
            className="h-7 text-xs w-24"
          />
          <Input
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddField();
            }}
            className="h-7 text-xs flex-1"
          />
          <Button
            onClick={handleAddField}
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            disabled={!newKey.trim() || !newValue.trim()}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="h-7"
        >
          <X className="h-3 w-3 mr-1" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(editedMetadata)}
          className="h-7"
        >
          <Check className="h-3 w-3 mr-1" />
          Save
        </Button>
      </div>
    </Card>
  );
}
