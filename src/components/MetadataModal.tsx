import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";

interface MetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: string) => void;
  initialText?: string;
  frame?: number;
}

export function MetadataModal({ 
  isOpen, 
  onClose, 
  onSave, 
  initialText = "",
  frame 
}: MetadataModalProps) {
  const [text, setText] = useState(initialText);

  const handleSave = () => {
    onSave(text);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Frame {frame} Metadata</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter metadata description..."
            className="min-h-[200px] resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
