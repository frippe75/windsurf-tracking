/**
 * SAM3 detect/track orchestration, extracted from pages/Index.tsx (which was a ~2600-line
 * component). Guards + toasts + state updates live here; the pure mapping is in lib/samMapping
 * and the network calls are in lib/pipelineApi. Behavior is preserved EXACTLY from the inline
 * handlers (see docs/REFACTOR_DEBT.md for the preserved quirks: `window.__samVideoId` /
 * `document.querySelector("video")` DOM reads, stale instanceNumber snapshot, two error strings).
 */
import { useCallback, Dispatch, SetStateAction } from "react";
import { Annotation, Class, Instance, Track } from "@/types/annotation";
import { detectionsToAnnotations, trackFramesToAnnotations, SamDetection } from "@/lib/samMapping";
import { segment, submitTrack, pollTrack } from "@/lib/pipelineApi";

type ToastFn = (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;

export interface UseSamToolDeps {
  classes: Class[];
  selectedClassId?: string;
  instances: Instance[];
  setInstances: Dispatch<SetStateAction<Instance[]>>;
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  currentFrame: number;
  videoNativeWidth: number;
  videoNativeHeight: number;
  videoFps: number;
  toast: ToastFn;
}

function samVideoId(): string | undefined {
  return (window as unknown as { __samVideoId?: string }).__samVideoId;
}

export function useSamTool(deps: UseSamToolDeps) {
  const {
    classes, selectedClassId, instances, setInstances, setAnnotations, setTracks,
    currentFrame, videoNativeWidth, videoNativeHeight, videoFps, toast,
  } = deps;

  // Commit SAM3 concept detections (native-pixel bboxes) as annotations under the target/selected
  // class at the current frame. `targetClassId` overrides the selection (used by detect-all).
  const addDetections = useCallback(
    (dets: SamDetection[], targetClassId?: string): number => {
      const selectedClass = classes.find((c) => c.id === (targetClassId ?? selectedClassId));
      if (!selectedClass) {
        toast({ title: "No class selected", description: "Select a class before adding detections." });
        return 0;
      }
      const { instances: newInstances, annotations: newAnnotations } = detectionsToAnnotations(dets, {
        classId: selectedClass.id,
        existingInstances: instances,
        currentFrame,
        nativeWidth: videoNativeWidth,
        nativeHeight: videoNativeHeight,
      });
      if (newAnnotations.length === 0) return 0;
      setInstances((prev) => [...prev, ...newInstances]);
      setAnnotations((prev) => [...prev, ...newAnnotations]);
      toast({
        title: "Detections added",
        description: `${newAnnotations.length} object(s) added to ${selectedClass.name} at frame ${currentFrame}`,
      });
      return newAnnotations.length;
    },
    [classes, selectedClassId, instances, setInstances, setAnnotations, currentFrame, videoNativeWidth, videoNativeHeight, toast],
  );

  // Detect EVERY class in one pass: run each class's own concept prompt on the current frame and
  // file the results into that class (the payoff of coupling the prompt to the class).
  const detectAllClasses = useCallback(
    async (minScore: number, onProgress?: (s: string) => void): Promise<number> => {
      const vidEl = document.querySelector("video") as HTMLVideoElement | null;
      const vid = samVideoId();
      if (!vidEl || !vidEl.videoWidth) throw new Error("Load a video first (make sure a frame is showing).");
      if (!vid) throw new Error("No video id — open a video in a project first.");
      const withPrompt = classes.filter((c) => (c.conceptPrompt ?? c.name).trim());
      if (withPrompt.length === 0) throw new Error("No classes with a concept prompt.");
      let total = 0;
      for (const cls of withPrompt) {
        onProgress?.(`Detecting ${cls.name}…`);
        const dets = (await segment(
          { video_id: vid, time_sec: vidEl.currentTime, text: (cls.conceptPrompt ?? cls.name).trim() },
          `detecting ${cls.name}`,
        ))
          .filter((x) => Array.isArray(x.bbox) && x.bbox.length === 4)
          .filter((x) => (x.score ?? 0) >= minScore);
        total += addDetections(dets, cls.id);
      }
      toast({ title: "Detect all complete", description: `${total} object(s) across ${withPrompt.length} class(es)` });
      return total;
    },
    [classes, addDetections, toast],
  );

  // SAM3-native VIDEO tracking: submit a window to the SAM3 video predictor, poll to completion,
  // ingest per-frame masklets as annotations (one Instance per tracked object_id).
  const track = useCallback(
    async (text: string, extentFrames: number, onProgress?: (s: string) => void): Promise<number> => {
      const selectedClass = classes.find((c) => c.id === selectedClassId);
      if (!selectedClass) {
        toast({ title: "No class selected", description: "Select a class before tracking." });
        return 0;
      }
      const vid = samVideoId();
      if (!vid) throw new Error("No video id — open a video in a project first.");
      const start = currentFrame;
      const end = currentFrame + Math.max(1, extentFrames) - 1;
      onProgress?.("Submitting…");
      const { job_id, model } = await submitTrack({ video_id: vid, start_frame: start, end_frame: end, fps: videoFps, text });
      const out = await pollTrack(job_id, model, { onProgress, extentFrames });

      const trackId = `trk-${Date.now()}`;
      const { instances: newInstances, annotations: newAnnotations } = trackFramesToAnnotations(out.frames || [], {
        classId: selectedClass.id,
        existingInstances: instances,
        trackId,
      });
      if (newAnnotations.length > 0) {
        // record the track so it can be reviewed/thinned (start/end/prompt), thinning starts empty
        setTracks((prev) => [...prev, { id: trackId, startFrame: start, endFrame: end, prompt: text, createdAt: Date.now(), thinning: [] }]);
      }
      setInstances((prev) => [...prev, ...newInstances]);
      setAnnotations((prev) => [...prev, ...newAnnotations]);
      toast({
        title: "Tracking complete",
        description: `${newInstances.length} object(s) tracked across ${(out.frames || []).length} frames`,
      });
      return newAnnotations.length;
    },
    [classes, selectedClassId, instances, setInstances, setAnnotations, setTracks, currentFrame, videoFps, toast],
  );

  return { addDetections, detectAllClasses, track };
}
