import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2 } from "lucide-react";
import { getVideoDatasetVersions, type DatasetVersionSummary } from "@/lib/api";
import { detectWithModel } from "@/lib/pipelineApi";

/**
 * Trained-detector assist (a method under Annotate): run one of the project's *own* trained YOLO
 * models on the current frame → boxes become annotations. Closes the flywheel: model → auto-annotate
 * → review → next dataset version. Reuses onAddDetections (native-pixel [x1,y1,x2,y2]).
 */
type Props = {
  videoId?: string | null;
  timeSec: number;
  nativeWidth: number;
  nativeHeight: number;
  selectedClassId?: string | null;
  onAddDetections: (dets: { bbox: number[]; score?: number }[], classId?: string) => number;
};

const bestMap = (v: DatasetVersionSummary) => v.models.reduce((m, r) => Math.max(m, r.metrics?.mAP50 ?? 0), 0);

export function TrainedDetectorPanel({ videoId, timeSec, nativeWidth, nativeHeight, selectedClassId, onAddDetections }: Props) {
  const [versions, setVersions] = useState<DatasetVersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!videoId) return;
    getVideoDatasetVersions(videoId)
      .then((vs) => {
        const trained = vs.filter((v) => v.models.length > 0).sort((a, b) => bestMap(b) - bestMap(a));
        setVersions(trained);
        if (trained[0]) setSelected(trained[0].version_id);
      })
      .catch((e) => setMsg(String(e?.message ?? e)));
  }, [videoId]);

  const run = async () => {
    if (!videoId || !selected) return;
    setRunning(true);
    setMsg("");
    try {
      const dets = await detectWithModel({ version_id: selected, video_id: videoId, time_sec: timeSec });
      // normalized [x,y,w,h] → native-pixel [x1,y1,x2,y2] for onAddDetections
      const px = dets.map((d) => ({
        bbox: [d.bbox[0] * nativeWidth, d.bbox[1] * nativeHeight,
               (d.bbox[0] + d.bbox[2]) * nativeWidth, (d.bbox[1] + d.bbox[3]) * nativeHeight],
        score: d.score,
      }));
      const n = onAddDetections(px, selectedClassId ?? undefined);
      setMsg(n > 0 ? `Added ${n} detection(s).` : "No detections on this frame.");
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  if (!videoId) return null;

  return (
    <Card className="p-3 bg-card border-border space-y-2">
      <div className="flex items-center gap-1.5">
        <Wand2 className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Trained detector</h4>
      </div>
      {versions === null && <div className="text-[11px] text-muted-foreground">Loading models…</div>}
      {versions?.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No trained models yet — train one in the Train tab.</div>
      )}
      {versions && versions.length > 0 && (
        <>
          <select
            value={selected}
            disabled={running}
            onChange={(e) => setSelected(e.target.value)}
            className="h-7 w-full rounded border border-input bg-background px-1 text-xs"
          >
            {versions.map((v) => (
              <option key={v.version_id} value={v.version_id}>
                {v.version_id.slice(0, 12)} · mAP {bestMap(v).toFixed(2)}
              </option>
            ))}
          </select>
          <Button size="sm" className="h-7 w-full" disabled={running || !selectedClassId} onClick={run}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            <span className="ml-1">{running ? "Detecting…" : "Run on current frame"}</span>
          </Button>
          {!selectedClassId && <div className="text-[10px] text-muted-foreground">Select a class first.</div>}
        </>
      )}
      {msg && <div className="text-[11px] text-muted-foreground break-words">{msg}</div>}
    </Card>
  );
}
