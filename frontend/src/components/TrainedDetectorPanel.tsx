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
  // All videos in the active project. A trained model runs on ANY clip's current frame (the model
  // weights are independent of the source clip), so the picker lists every model in the project —
  // switching the loaded clip must not make a trained model disappear.
  videoIds?: string[];
  timeSec: number;
  nativeWidth: number;
  nativeHeight: number;
  selectedClassId?: string | null;
  onAddDetections: (dets: { bbox: number[]; score?: number }[], classId?: string) => number;
};

const bestMap = (v: DatasetVersionSummary) => v.models.reduce((m, r) => Math.max(m, r.metrics?.mAP50 ?? 0), 0);

// Merge trained versions across all the project's clips, dedup by version_id, best mAP first.
export async function loadProjectModels(videoIds: string[]): Promise<DatasetVersionSummary[]> {
  const lists = await Promise.all(videoIds.map((id) => getVideoDatasetVersions(id).catch(() => [])));
  const byId = new Map<string, DatasetVersionSummary>();
  for (const v of lists.flat()) {
    if (v.models.length > 0 && !byId.has(v.version_id)) byId.set(v.version_id, v);
  }
  return [...byId.values()].sort((a, b) => bestMap(b) - bestMap(a));
}

export function TrainedDetectorPanel({ videoId, videoIds, timeSec, nativeWidth, nativeHeight, selectedClassId, onAddDetections }: Props) {
  const [versions, setVersions] = useState<DatasetVersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  // Fetch project-wide so the list is stable across clip switches. Fall back to the loaded clip.
  const ids = (videoIds && videoIds.length > 0 ? videoIds : videoId ? [videoId] : []);
  const idsKey = ids.join(",");
  useEffect(() => {
    if (ids.length === 0) return;
    loadProjectModels(ids)
      .then((trained) => {
        setVersions(trained);
        setSelected((cur) => (cur && trained.some((v) => v.version_id === cur) ? cur : trained[0]?.version_id ?? ""));
      })
      .catch((e) => setMsg(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

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
