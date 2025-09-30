import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, CheckCircle2, XCircle, Trash2 } from "lucide-react";

export interface TrackingJob {
  id: string;
  startFrame: number;
  stopFrame: number;
  objectIds: string[];
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
}

interface TrackingJobsProps {
  jobs: TrackingJob[];
  onProcessJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
}

export function TrackingJobs({ jobs, onProcessJob, onDeleteJob }: TrackingJobsProps) {
  const getStatusIcon = (status: TrackingJob["status"]) => {
    switch (status) {
      case "pending":
        return <Play className="h-3 w-3" />;
      case "processing":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-3 w-3" />;
      case "failed":
        return <XCircle className="h-3 w-3" />;
    }
  };

  const getStatusColor = (status: TrackingJob["status"]) => {
    switch (status) {
      case "pending":
        return "secondary";
      case "processing":
        return "default";
      case "completed":
        return "outline";
      case "failed":
        return "destructive";
    }
  };

  return (
    <Card className="p-4 bg-card border-border space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tracking Jobs</h3>
        <Badge variant="secondary">{jobs.length}</Badge>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No tracking jobs yet. Create START/STOP keyframes to define segments.
          </p>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="p-2.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors space-y-1.5"
            >
              {/* Top row: Frame range and actions */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Frames {job.startFrame} → {job.stopFrame}
                </div>
                <div className="flex gap-1">
                  {job.status === "pending" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onProcessJob(job.id)}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onDeleteJob(job.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              
              {/* Second row: Status and object count in light grey */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Badge variant={getStatusColor(job.status)} className="text-xs">
                  {getStatusIcon(job.status)}
                  <span className="ml-1">{job.status}</span>
                </Badge>
                <span className="text-xs">
                  {job.objectIds.length} object{job.objectIds.length !== 1 ? "s" : ""}
                </span>
              </div>
              
              {/* Progress bar */}
              {job.status === "processing" && job.progress !== undefined && (
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
