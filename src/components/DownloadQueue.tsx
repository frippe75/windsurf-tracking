import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { X, Download, CheckCircle2, AlertCircle } from "lucide-react";

export interface DownloadJob {
  id: string;
  url: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'failed';
  progress: number;
  current_step?: string;
  video_id?: string;
  error?: string;
}

interface DownloadQueueProps {
  downloads: DownloadJob[];
  onCancel: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}

export function DownloadQueue({ downloads, onCancel, onRemove }: DownloadQueueProps) {
  if (downloads.length === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-medium">Download Queue ({downloads.length})</h3>
      <div className="space-y-2">
        {downloads.map((download) => (
          <div key={download.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
            <div className="flex-shrink-0">
              {download.status === 'completed' && (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              )}
              {download.status === 'failed' && (
                <AlertCircle className="w-4 h-4 text-destructive" />
              )}
              {(download.status === 'downloading' || download.status === 'processing' || download.status === 'queued') && (
                <Download className="w-4 h-4 text-primary animate-pulse" />
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-medium truncate">
                  {new URL(download.url).hostname}
                </p>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {download.progress}%
                </span>
              </div>
              
              <Progress value={download.progress} className="h-1.5 mb-1" />
              
              {download.current_step && (
                <p className="text-xs text-muted-foreground truncate">
                  {download.current_step}
                </p>
              )}
              
              {download.error && (
                <p className="text-xs text-destructive truncate">
                  {download.error}
                </p>
              )}
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="flex-shrink-0 h-6 w-6 p-0"
              onClick={() => {
                if (download.status === 'completed' || download.status === 'failed') {
                  onRemove(download.id);
                } else {
                  onCancel(download.id);
                }
              }}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
