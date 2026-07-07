import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, CheckCircle2, XCircle, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export interface SubJob {
  job_id: string;
  name: string;
  start_frame: number;
  end_frame: number;
  frames: number;
  prompt_source: 'manual' | 'propagated';
  status?: "pending" | "processing" | "completed" | "failed";
  progress?: number;
}

export interface TrackingJob {
  id: string;
  startFrame: number;
  stopFrame: number;
  objectIds: string[];
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  subJobs?: SubJob[];
  estimatedMemory?: string;
  isSplit?: boolean;
}

interface TrackingJobsProps {
  jobs: TrackingJob[];
  onProcessJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onFrameChange?: (frame: number) => void;
}

export function TrackingJobs({ jobs, onProcessJob, onDeleteJob, onFrameChange }: TrackingJobsProps) {
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const toggleJobExpansion = (jobId: string) => {
    setExpandedJobs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  const getStatusIcon = (status: TrackingJob["status"]) => {
    switch (status) {
      case "pending":
        return <Play className="h-3 w-3" />;
      case "processing":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-[hsl(var(--sail-green))]" />;
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
          jobs.map((job) => {
            const isExpanded = expandedJobs.has(job.id);
            const hasSubJobs = job.subJobs && job.subJobs.length > 0;
            
            return (
              <div key={job.id} className="space-y-1">
                {/* Main job card */}
                <div className="rounded-lg bg-secondary hover:bg-secondary/80 transition-colors relative overflow-hidden">
                  <div className="p-2.5 space-y-1.5">
                    {/* Top row: Frame range and actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {hasSubJobs && (
                          <button
                            onClick={() => toggleJobExpansion(job.id)}
                            className="hover:bg-muted/50 rounded p-0.5"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <div className="text-sm font-medium">
                          Frames{" "}
                          <button
                            onClick={() => onFrameChange?.(job.startFrame)}
                            className="hover:text-primary hover:underline cursor-pointer"
                          >
                            {job.startFrame}
                          </button>
                          {" → "}
                          <button
                            onClick={() => onFrameChange?.(job.stopFrame)}
                            className="hover:text-primary hover:underline cursor-pointer"
                          >
                            {job.stopFrame}
                          </button>
                        </div>
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
                    
                    {/* Second row: Status and metadata */}
                    <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                      {job.status === "processing" ? (
                        <div className="flex items-center gap-1 text-xs">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>processing</span>
                        </div>
                      ) : (
                        <Badge variant={getStatusColor(job.status)} className="text-xs">
                          {getStatusIcon(job.status)}
                          <span className="ml-1">{job.status}</span>
                        </Badge>
                      )}
                      <span className="text-xs">
                        {job.objectIds.length} object{job.objectIds.length !== 1 ? "s" : ""}
                      </span>
                      {job.isSplit && (
                        <Badge variant="outline" className="text-xs">
                          {job.subJobs?.length} parts
                        </Badge>
                      )}
                      {job.estimatedMemory && (
                        <span className="text-xs text-muted-foreground">
                          ~{job.estimatedMemory}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Progress bar */}
                  {job.status === "processing" && job.progress !== undefined && (
                    <div className="w-full bg-muted/50 h-[3px]">
                      <div
                        className="bg-primary h-full transition-all"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Sub-jobs (expanded view) */}
                {hasSubJobs && isExpanded && (
                  <div className="ml-6 space-y-1">
                    {job.subJobs!.map((subJob, idx) => (
                      <div
                        key={subJob.job_id}
                        className="rounded-lg bg-muted/50 hover:bg-muted transition-colors relative overflow-hidden"
                      >
                        <div className="p-2 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-medium">
                              {subJob.name} ({subJob.frames} frames)
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {subJob.prompt_source}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <button
                              onClick={() => onFrameChange?.(subJob.start_frame)}
                              className="hover:text-primary hover:underline cursor-pointer"
                            >
                              {subJob.start_frame}
                            </button>
                            {" → "}
                            <button
                              onClick={() => onFrameChange?.(subJob.end_frame)}
                              className="hover:text-primary hover:underline cursor-pointer"
                            >
                              {subJob.end_frame}
                            </button>
                          </div>
                          {subJob.status === "processing" && subJob.progress !== undefined && (
                            <div className="w-full bg-muted/50 h-[2px] mt-1">
                              <div
                                className="bg-primary h-full transition-all"
                                style={{ width: `${subJob.progress}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
