/**
 * Tracking-jobs domain, extracted from pages/Index.tsx.
 *
 * Owns:
 * - `trackingJobs` state
 * - auto-creation of pending jobs from START->STOP keyframe pairs
 * - job creation from an annotation (handleStartTracking)
 * - job execution: create on backend (auto-split aware), execute + poll each
 *   sub-job, ingest results into tracked annotations (handleProcessJob)
 * - job deletion
 *
 * Result -> annotation conversion goes through lib/coordinates
 * (nativeBBoxToPct / bboxToPolygon / isMaskCropped): backend bboxes are
 * ALWAYS native video pixels, annotations are display percentages.
 * API functions are injected for testability and default to lib/api.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { TrackingJob } from "@/components/TrackingJobs";
import { Annotation, Keyframe } from "@/types/annotation";
import {
  createTrackingJob as apiCreateTrackingJob,
  executeTrackingJob as apiExecuteTrackingJob,
  getTrackingJobStatus as apiGetTrackingJobStatus,
  getTrackingJobResults as apiGetTrackingJobResults,
  type SubJob,
} from "@/lib/api";
import { pctToNative, nativeBBoxToPct, bboxToPolygon, isMaskCropped } from "@/lib/coordinates";
import type { ToastOptions } from "@/hooks/useProjects";

export interface TrackingApi {
  createTrackingJob: typeof apiCreateTrackingJob;
  executeTrackingJob: typeof apiExecuteTrackingJob;
  getTrackingJobStatus: typeof apiGetTrackingJobStatus;
  getTrackingJobResults: typeof apiGetTrackingJobResults;
}

export interface UseTrackingJobsOptions {
  videoId: string;
  videoNativeWidth: number;
  videoNativeHeight: number;
  annotations: Annotation[];
  keyframes: Keyframe[];
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  toast: (options: ToastOptions) => void;
  /** Injectable API client (tests); defaults to lib/api. */
  api?: TrackingApi;
}

const defaultApi: TrackingApi = {
  createTrackingJob: apiCreateTrackingJob,
  executeTrackingJob: apiExecuteTrackingJob,
  getTrackingJobStatus: apiGetTrackingJobStatus,
  getTrackingJobResults: apiGetTrackingJobResults,
};

/** Loose shape of a per-frame backend tracking result (schema has drifted). */
interface RawTrackingFrame {
  frame_number?: number;
  frame?: number;
  object_ids?: number[];
  bboxes?: Array<[number, number, number, number] | undefined>;
  masks_base64?: string[];
  scores?: number[];
  bbox?: [number, number, number, number];
  mask_base64?: string;
  maskBase64?: string;
  mask?: { base64?: string };
  score?: number;
  confidence?: number;
}

interface NormalizedTrackingResult {
  frame_number: number;
  object_id: number;
  bbox: [number, number, number, number];
  mask_base64?: string;
  score?: number;
}

export function useTrackingJobs(options: UseTrackingJobsOptions) {
  const {
    videoId,
    videoNativeWidth,
    videoNativeHeight,
    annotations,
    keyframes,
    setAnnotations,
    toast,
  } = options;
  const api = options.api ?? defaultApi;

  const [trackingJobs, setTrackingJobs] = useState<TrackingJob[]>([]);

  // Auto-create tracking jobs from START->STOP keyframe pairs
  useEffect(() => {
    const sortedKeyframes = [...keyframes].sort((a, b) => a.frame - b.frame);
    const updatedJobs = new Map(trackingJobs.map(job => [job.id, job]));

    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].type === "START") {
        const startFrame = sortedKeyframes[i].frame;
        const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");

        if (stopKeyframe) {
          const jobId = `segment-${startFrame}-${stopKeyframe.frame}`;

          // Find all annotations that exist in this segment
          const segmentAnnotations = annotations
            .filter(ann => ann.frameCreated >= startFrame && ann.frameCreated <= stopKeyframe.frame)
            .map(ann => ann.id);

          // Update existing job or create new one
          const existingJob = updatedJobs.get(jobId);
          if (existingJob) {
            // Update objectIds if new annotations were added
            updatedJobs.set(jobId, {
              ...existingJob,
              objectIds: segmentAnnotations,
            });
          } else {
            // Create new job
            updatedJobs.set(jobId, {
              id: jobId,
              startFrame,
              stopFrame: stopKeyframe.frame,
              objectIds: segmentAnnotations,
              status: "pending",
            });
          }
        }
      }
    }

    // Remove jobs for segments that no longer have START->STOP pairs
    const validJobIds = new Set<string>();
    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].type === "START") {
        const startFrame = sortedKeyframes[i].frame;
        const stopKeyframe = sortedKeyframes.slice(i + 1).find(kf => kf.type === "STOP");
        if (stopKeyframe) {
          validJobIds.add(`segment-${startFrame}-${stopKeyframe.frame}`);
        }
      }
    }

    // Filter out invalid jobs (keep only valid ones and those that are processing/completed)
    const finalJobs = Array.from(updatedJobs.values()).filter(
      job => validJobIds.has(job.id) || job.status !== "pending"
    );

    // Only update state if jobs actually changed
    if (JSON.stringify(finalJobs) !== JSON.stringify(trackingJobs)) {
      setTrackingJobs(finalJobs);
    }
  }, [keyframes, annotations, trackingJobs]);

  const handleStartTracking = (annotationId: string) => {
    const annotation = annotations.find(a => a.id === annotationId);
    if (!annotation) return;

    const startFrame = annotation.frameCreated;
    const stopKeyframe = keyframes.find(
      k => k.type === "STOP" && k.frame > startFrame
    );

    if (!stopKeyframe) {
      toast({
        title: "No STOP keyframe found",
        description: "Add a STOP keyframe after this annotation",
      });
      return;
    }

    const newJob: TrackingJob = {
      id: `job-${Date.now()}`,
      startFrame,
      stopFrame: stopKeyframe.frame,
      objectIds: [annotationId],
      status: "pending",
    };

    setTrackingJobs([...trackingJobs, newJob]);
    toast({
      title: "Tracking job created",
      description: `Frames ${startFrame} → ${stopKeyframe.frame}`,
    });
  };

  const handleProcessJob = async (jobId: string) => {
    const job = trackingJobs.find(j => j.id === jobId);
    if (!job || !videoId) return;

    // Extract click_prompts from annotations in this segment
    const segmentAnnotations = annotations.filter(ann =>
      job.objectIds.includes(ann.id) && ann.sam2Prompts && ann.sam2Prompts.length > 0
    );

    if (segmentAnnotations.length === 0) {
      toast({
        title: "No prompts found",
        description: "Annotations in this segment need SAM2 click prompts",
        variant: "destructive",
      });
      return;
    }

    // Collect ALL click prompts from all annotations
    const allClickPrompts = segmentAnnotations.flatMap(ann =>
      ann.sam2Prompts!.map(p => ({
        ...pctToNative(p.x, p.y, videoNativeWidth, videoNativeHeight),
        type: p.type
      }))
    );

    console.log('🎯 Tracking job click prompts:', {
      promptCount: allClickPrompts.length,
      prompts: allClickPrompts,
      nativeResolution: `${videoNativeWidth}×${videoNativeHeight}`
    });

    try {
      // Create tracking job with backend (auto-splits if needed)
      toast({
        title: "Creating tracking job",
        description: "Analyzing segment size and memory requirements...",
      });

      const createResponse = await api.createTrackingJob(videoId, [{
        start_frame: job.startFrame,
        end_frame: job.stopFrame,
        click_prompts: allClickPrompts
      }]);

      console.log('📦 Tracking job creation response:', createResponse);

      // Handle both response formats: single_job or auto_split_result
      let subJobs: SubJob[];
      let isSplit = false;
      let estimatedMemory = '';

      if (createResponse.auto_split_result) {
        // Multi-part job (split required)
        const { auto_split_result } = createResponse;
        isSplit = auto_split_result.split_required;
        estimatedMemory = auto_split_result.estimated_memory || '';
        subJobs = auto_split_result.created_jobs;

        toast({
          title: "Job auto-split",
          description: `Split into ${subJobs.length} parts (~${estimatedMemory})`,
        });
      } else if (createResponse.single_job) {
        // Single job (no split needed)
        const { single_job } = createResponse;
        isSplit = false;
        estimatedMemory = single_job.estimated_memory || '';
        subJobs = [{
          job_id: single_job.job_id,
          name: single_job.name || 'Tracking Job',
          start_frame: single_job.start_frame,
          end_frame: single_job.end_frame,
          frames: single_job.frames,
          prompt_source: 'manual'
        }];
      } else {
        console.error('❌ Invalid tracking response structure:', createResponse);
        throw new Error(`Invalid response format. Expected 'auto_split_result' or 'single_job'`);
      }

      console.log(`✅ Job created with ${subJobs.length} sub-job(s)`);

      // Update job with auto-split info
      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? {
            ...j,
            status: "processing" as const,
            progress: 0,
            isSplit,
            estimatedMemory,
            subJobs: subJobs.map(subJob => ({
              ...subJob,
              status: "pending" as const
            }))
          } : j
        )
      );

      // Execute each sub-job sequentially
      for (let i = 0; i < subJobs.length; i++) {
        const subJob = subJobs[i];

        // Mark sub-job as processing
        setTrackingJobs(jobs =>
          jobs.map(j =>
            j.id === jobId && j.subJobs ? {
              ...j,
              subJobs: j.subJobs.map((sj, idx) =>
                idx === i ? { ...sj, status: "processing" as const, progress: 0 } : sj
              )
            } : j
          )
        );

        // Execute tracking
        console.log(`🚀 Starting tracking job: ${subJob.job_id}`);
        await api.executeTrackingJob(subJob.job_id);

        // Poll for completion with timeout
        let completed = false;
        let pollCount = 0;
        const maxPolls = 300; // 5 minutes max (300 seconds)

        while (!completed && pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every second
          pollCount++;

          const status = await api.getTrackingJobStatus(subJob.job_id);

          console.log(`📊 Poll #${pollCount} for job ${subJob.name}:`, status.status, `${status.percentage}%`);

          // Update progress
          setTrackingJobs(jobs =>
            jobs.map(j =>
              j.id === jobId && j.subJobs ? {
                ...j,
                progress: Math.round(((i + (status.percentage || 0) / 100) / subJobs.length) * 100),
                subJobs: j.subJobs.map((sj, idx) =>
                  idx === i ? { ...sj, progress: status.percentage } : sj
                )
              } : j
            )
          );

          if (status.status === "completed") {
            console.log(`✅ Job ${subJob.name} completed!`);
            completed = true;

            // Mark sub-job as completed
            setTrackingJobs(jobs =>
              jobs.map(j =>
                j.id === jobId && j.subJobs ? {
                  ...j,
                  subJobs: j.subJobs.map((sj, idx) =>
                    idx === i ? { ...sj, status: "completed" as const, progress: 100 } : sj
                  )
                } : j
              )
            );
          } else if (status.status === "failed") {
            console.error(`❌ Job ${subJob.name} failed`);
            throw new Error(`Sub-job ${subJob.name} failed: ${status.error}`);
          }
        }

        if (!completed) {
          console.error(`⏱️ Polling timeout after ${pollCount} attempts for job ${subJob.name}`);
          throw new Error(`Tracking job timed out after ${pollCount} seconds. Backend may still be processing.`);
        }
      }

      // All sub-jobs completed - fetch and create annotations from tracking results
      const allResults: NormalizedTrackingResult[] = [];

      console.log(`📦 Fetching results from ${subJobs.length} sub-job(s)...`);

      for (let subJobIndex = 0; subJobIndex < subJobs.length; subJobIndex++) {
        const subJob = subJobs[subJobIndex];
        try {
          const results = await api.getTrackingJobResults(subJob.job_id);

          // Normalize backend results to a consistent per-frame array
          const resultsField: unknown = results.results;
          const nestedFrames = (resultsField as { frames?: unknown } | null | undefined)?.frames;
          const frames: RawTrackingFrame[] = Array.isArray(resultsField)
            ? (resultsField as RawTrackingFrame[])
            : Array.isArray(nestedFrames)
              ? (nestedFrames as RawTrackingFrame[])
              : [];

          // Map multi-object backend results to flat array of per-object-per-frame results
          const normalized: NormalizedTrackingResult[] = [];

          for (const r of frames) {
            const frame_number = r.frame_number ?? r.frame;
            if (typeof frame_number !== 'number') continue;

            // Handle multi-object format: object_ids, bboxes, masks_base64 arrays
            if (Array.isArray(r.object_ids) && Array.isArray(r.bboxes)) {
              for (let i = 0; i < r.object_ids.length; i++) {
                const bbox = r.bboxes[i];
                if (!bbox) continue;

                normalized.push({
                  frame_number,
                  object_id: r.object_ids[i],
                  bbox,
                  mask_base64: r.masks_base64?.[i],
                  score: r.scores?.[i]
                });
              }
            }
            // Fallback: single-object format
            else {
              const bbox = r.bbox ?? (Array.isArray(r.bboxes) ? r.bboxes[0] : undefined);
              const mask_base64 = r.mask_base64 ?? r.maskBase64 ?? r.mask?.base64;
              const score = r.score ?? r.confidence;

              if (bbox) {
                normalized.push({
                  frame_number,
                  object_id: 1, // Default to object_id 1 for backward compatibility
                  bbox,
                  mask_base64,
                  score
                });
              }
            }
          }

          if (normalized.length > 0) {
            console.log(`✅ Fetched ${normalized.length} results from ${subJob.name}:`, {
              firstFrame: normalized[0]?.frame_number,
              lastFrame: normalized[normalized.length - 1]?.frame_number,
              sampleBbox: normalized[0]?.bbox,
              hasMasks: normalized.some(r => !!r.mask_base64)
            });
            allResults.push(...normalized);
          } else {
            console.warn(`⚠️ ${subJob.name} returned no usable per-frame tracking data:`, results);
            toast({
              title: "No Tracking Frames Parsed",
              description: `Received results but could not parse frames. Check backend result schema (expect frames[].bbox or bboxes[0]).`,
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error(`Failed to fetch results for ${subJob.name}:`, error);
        }
      }

      console.log(`📊 Total tracking results retrieved: ${allResults.length}`);
      console.log('Sample of first 3 results:', allResults.slice(0, 3).map(r => ({
        frame: r.frame_number,
        bbox: r.bbox,
        hasMask: !!r.mask_base64
      })));

      // Create new annotations for each tracked frame and object
      if (allResults.length > 0) {
        const newAnnotations: Annotation[] = [];

        // Group results by object_id to map back to original annotations
        console.log(`🎨 Creating annotations for ${segmentAnnotations.length} objects...`);

        // Always skip the starting frame result to avoid duplicating the manual keyframe
        const filteredResults = allResults.filter(r => r.frame_number !== job.startFrame);

        for (const result of filteredResults) {

          // Map object_id back to original annotation (object_id is 1-based)
          const originalAnnotation = segmentAnnotations[result.object_id - 1];
          if (!originalAnnotation) {
            console.warn(`⚠️ No annotation found for object_id ${result.object_id}`);
            continue;
          }
          // Decode mask to get dimensions
          let maskWidth: number | undefined;
          let maskHeight: number | undefined;
          if (result.mask_base64) {
            try {
              const img = new Image();
              img.src = `data:image/png;base64,${result.mask_base64}`;
              await img.decode();
              maskWidth = img.width;
              maskHeight = img.height;
            } catch (e) {
              console.warn('Failed to decode mask for frame', result.frame_number);
            }
          }

          // ⚠️ CRITICAL: Backend bbox is ALWAYS in native video coordinates, NOT mask coordinates
          const [x1, y1, x2, y2] = result.bbox;
          const bbox = nativeBBoxToPct([x1, y1, x2, y2], videoNativeWidth || 1280, videoNativeHeight || 720);
          const points = bboxToPolygon(bbox);
          const isCropped = isMaskCropped(maskWidth, maskHeight, videoNativeWidth, videoNativeHeight);

          newAnnotations.push({
            id: `ann-tracked-${result.object_id}-${result.frame_number}-${Date.now()}-${Math.random()}`,
            instanceId: originalAnnotation.instanceId,
            points,
            bbox,
            maskBase64: result.mask_base64,
            maskBBox: bbox,
            maskWidth,
            maskHeight,
            maskIsCropped: isCropped,
            frameCreated: result.frame_number,
            isKeyframe: false // Tracked, not manual
          });
        }

        console.log(`✅ Created ${newAnnotations.length} annotations across ${segmentAnnotations.length} objects. Sample:`,
          newAnnotations.slice(0, 3).map(a => ({ frame: a.frameCreated, bbox: a.bbox, instanceId: a.instanceId }))
        );

        // Add all new tracked annotations
        setAnnotations(prevAnnotations => [...prevAnnotations, ...newAnnotations]);
        console.log(`✅ Added ${newAnnotations.length} tracked annotations to state`);
      }

      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? { ...j, status: "completed" as const, progress: 100 } : j
        )
      );

      // (Removed) Avoid marking original keyframe as tracked across range to prevent duplicate overlays
      // We rely on per-frame tracked annotations created above.

      toast({
        title: "Tracking completed",
        description: `Created ${allResults.length} annotations across ${subJobs.length} segment(s)`,
      });

    } catch (error) {
      console.error("Tracking failed:", error);

      setTrackingJobs(jobs =>
        jobs.map(j =>
          j.id === jobId ? { ...j, status: "failed" as const } : j
        )
      );

      toast({
        title: "Tracking failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDeleteJob = (jobId: string) => {
    setTrackingJobs(jobs => jobs.filter(job => job.id !== jobId));
    toast({
      title: "Job deleted",
    });
  };

  return {
    trackingJobs,
    setTrackingJobs,
    handleStartTracking,
    handleProcessJob,
    handleDeleteJob,
  };
}
