import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Wand2, Loader2, Plus, Layers } from "lucide-react";
import { Class } from "@/types/annotation";

/**
 * SAM3 "Detect" tool — the active-tool options for the left rail (shown when the Detect tool is
 * selected). SAM3 is the concept/track engine, routed BY CAPABILITY (no model picker); SAM2 stays
 * the click-refine engine elsewhere.
 *
 * The concept prompt is a PROPERTY OF THE CLASS (`class.conceptPrompt`): the prompt shown here is
 * the selected class's phrase, editing it writes back to the class, and "Detect all classes" runs
 * every class's own phrase and files results into that class.
 *
 * Frame/window are extracted SERVER-SIDE (the app's <video> is a cross-origin blob: URL), so we
 * only send the video id + timestamp; the pipeline service resolves + extracts.
 */
const PIPELINE = "/pipeline";

type Detection = { bbox: number[]; score?: number; polygon?: Array<{ x: number; y: number }> };
type Box = { left: number; top: number; width: number; height: number; score?: number };

type Props = {
  classes: Class[];
  selectedClassId?: string;
  onUpdateClassPrompt: (classId: string, prompt: string) => void;
  onAddDetections: (dets: Detection[], targetClassId?: string) => number;
  onDetectAll: (minScore: number, onProgress: (s: string) => void) => Promise<number>;
  onTrack: (text: string, windowFrames: number, onProgress: (s: string) => void) => Promise<number>;
  videoReady: boolean;
};

export function SamTool({ classes, selectedClassId, onUpdateClassPrompt, onAddDetections, onDetectAll, onTrack, videoReady }: Props) {
  const [caps, setCaps] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(() => {
    const v = parseFloat(localStorage.getItem("samMinScore") || "0.5");
    return Number.isFinite(v) ? v : 0.5;
  });
  const [trackWindow, setTrackWindow] = useState(() => {
    const v = parseInt(localStorage.getItem("samTrackWindow") || "100");
    return Number.isFinite(v) ? v : 100;
  });
  const [busy, setBusy] = useState(false);
  const [allStatus, setAllStatus] = useState("");
  const [tracking, setTracking] = useState(false);
  const [trackStatus, setTrackStatus] = useState("");
  const [kept, setKept] = useState<Detection[]>([]);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${PIPELINE}/models`)
      .then((r) => r.json())
      .then((d) => setCaps(Array.from(new Set((d.models || []).flatMap((m: any) => m.capabilities || [])))))
      .catch((e) => setErr(`GET /pipeline/models: ${e}`));
  }, []);
  useEffect(() => localStorage.setItem("samMinScore", String(minScore)), [minScore]);
  useEffect(() => localStorage.setItem("samTrackWindow", String(trackWindow)), [trackWindow]);

  const hasConcept = caps.includes("concept-segment");
  const hasTrack = caps.includes("concept-track");
  const selectedClass = classes.find((c) => c.id === selectedClassId);
  const promptValue = selectedClass ? (selectedClass.conceptPrompt ?? selectedClass.name) : "";
  const ready = videoReady && !!selectedClass;
  const gate = useMemo(() => {
    if (!videoReady) return "Load a video to detect.";
    if (!selectedClass) return "Select a class — its concept phrase drives detection.";
    return "";
  }, [videoReady, selectedClass]);

  async function detect() {
    if (!selectedClass) return;
    setBusy(true);
    setErr("");
    setKept([]);
    setFoundCount(null);
    setBoxes([]);
    try {
      const vidEl = document.querySelector("video") as HTMLVideoElement | null;
      const vid = (window as unknown as { __samVideoId?: string }).__samVideoId;
      if (!vidEl || !vidEl.videoWidth) throw new Error("Load a video first (make sure a frame is showing).");
      if (!vid) throw new Error("No video id yet — open a video in a project first.");
      const r = await fetch(`${PIPELINE}/segment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "concept-segment",
          inputs: { video_id: vid, time_sec: vidEl.currentTime, text: promptValue },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      const dets: Detection[] = d.result?.detections ?? [];
      setFoundCount(dets.length);
      const keptDets = dets
        .filter((x) => Array.isArray(x.bbox) && x.bbox.length === 4)
        .filter((x) => (x.score ?? 0) >= minScore);
      setKept(keptDets);
      const rect = vidEl.getBoundingClientRect();
      const sx = rect.width / vidEl.videoWidth;
      const sy = rect.height / vidEl.videoHeight;
      setBoxes(
        keptDets.map((x) => {
          const [x1, y1, x2, y2] = x.bbox as number[];
          return { left: rect.left + x1 * sx, top: rect.top + y1 * sy, width: (x2 - x1) * sx, height: (y2 - y1) * sy, score: x.score };
        }),
      );
    } catch (e: any) {
      console.error("[SamTool] detect", e); // eslint-disable-line no-console
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function addObjects() {
    const n = onAddDetections(kept);
    if (n > 0) {
      setKept([]);
      setBoxes([]);
    }
  }

  async function detectAll() {
    setBusy(true);
    setErr("");
    setKept([]);
    setFoundCount(null);
    setBoxes([]);
    setAllStatus("Detecting…");
    try {
      await onDetectAll(minScore, setAllStatus);
    } catch (e: any) {
      console.error("[SamTool] detectAll", e); // eslint-disable-line no-console
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
      setAllStatus("");
    }
  }

  async function track() {
    if (!selectedClass) return;
    setTracking(true);
    setErr("");
    setTrackStatus("Submitting…");
    try {
      await onTrack(promptValue, trackWindow, setTrackStatus);
    } catch (e: any) {
      console.error("[SamTool] track", e); // eslint-disable-line no-console
      setErr(String(e?.message ?? e));
    } finally {
      setTracking(false);
      setTrackStatus("");
    }
  }

  const overlay =
    boxes.length > 0 ? (
      <div className="pointer-events-none fixed inset-0 z-40">
        {boxes.map((b, i) => (
          <div key={i} className="absolute border-2 border-emerald-400" style={{ left: b.left, top: b.top, width: b.width, height: b.height }}>
            <span className="absolute -top-4 left-0 bg-emerald-500 px-1 text-[10px] text-black">{b.score != null ? b.score.toFixed(2) : ""}</span>
          </div>
        ))}
      </div>
    ) : null;

  return (
    <>
      {overlay}
      <Card className="p-3 bg-card border-border space-y-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">Detect &amp; Track</h3>
          <Badge variant="secondary" className="ml-auto text-[10px]">SAM3</Badge>
        </div>

        {gate && <div className="text-[11px] text-muted-foreground">{gate}</div>}
        {!hasConcept && !err && <div className="text-[11px] text-muted-foreground">Loading models…</div>}

        {hasConcept && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">
                Concept phrase {selectedClass && <span className="text-foreground">· {selectedClass.name}</span>}
              </label>
              <Input
                value={promptValue}
                disabled={!selectedClass}
                onChange={(e) => selectedClass && onUpdateClassPrompt(selectedClass.id, e.target.value)}
                placeholder={selectedClass ? "e.g. windsurf sail rig" : "select a class"}
                className="h-8 text-xs"
                title="Saved on the class — reused every time you detect this class"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Min score</span>
                <span className="text-foreground">{minScore.toFixed(2)}</span>
              </div>
              <Slider value={[minScore]} min={0} max={1} step={0.05} onValueChange={([v]) => setMinScore(v)} />
            </div>

            <Button onClick={detect} disabled={!ready || busy} size="sm" className="w-full">
              {busy && !allStatus ? (<><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Detecting… (cold start ~1–4 min)</>) : "Detect on frame"}
            </Button>

            {foundCount !== null && (
              <div className="text-[11px] text-muted-foreground">{foundCount} found · {kept.length} ≥ {minScore.toFixed(2)}</div>
            )}
            {kept.length > 0 && (
              <Button onClick={addObjects} size="sm" variant="secondary" className="w-full">
                <Plus className="h-3.5 w-3.5 mr-1" />Add {kept.length} object{kept.length > 1 ? "s" : ""}
              </Button>
            )}

            {classes.length > 1 && (
              <Button onClick={detectAll} disabled={!videoReady || busy} size="sm" variant="outline" className="w-full">
                {allStatus ? (<><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{allStatus}</>) : (<><Layers className="h-3.5 w-3.5 mr-1" />Detect all {classes.length} classes</>)}
              </Button>
            )}

            {hasTrack && (
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Track window (frames)</span>
                  <span className="text-foreground">{trackWindow}</span>
                </div>
                <Slider value={[trackWindow]} min={10} max={120} step={10} onValueChange={([v]) => setTrackWindow(v)} />
                <Button onClick={track} disabled={!ready || tracking} size="sm" className="w-full">
                  {tracking ? (<><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{trackStatus || "Tracking…"}</>) : `Track ${selectedClass?.name ?? ""} · ${trackWindow} frames`}
                </Button>
                {tracking && (
                  <div className="h-1 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded bg-primary" />
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">SAM3-native · tracks the selected class from the current frame</div>
              </div>
            )}
          </>
        )}

        {err && <div className="text-[11px] text-destructive break-words">{err}</div>}
      </Card>
    </>
  );
}
