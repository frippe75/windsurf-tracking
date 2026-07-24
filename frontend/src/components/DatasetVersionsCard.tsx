import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, Boxes, Cpu } from "lucide-react";
import { getVideoDatasetVersions, type DatasetVersionSummary } from "@/lib/api";

/**
 * Models & Versions card (Project Manager stats): the immutable dataset versions built from this
 * video, each with the models trained on it (mAP, best-starred) — the lineage surfaced as UI.
 */
export function DatasetVersionsCard({ videoId }: { videoId?: string | null }) {
  const [versions, setVersions] = useState<DatasetVersionSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!videoId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    setVersions(null);
    setError("");
    getVideoDatasetVersions(videoId)
      .then((v) => !cancelled && setVersions(v))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  return (
    <Card className="p-3 bg-card border-border space-y-2">
      <div className="flex items-center gap-1.5">
        <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Models &amp; Versions</h4>
      </div>

      {!videoId && <div className="text-[11px] text-muted-foreground">Load a video to see its dataset versions.</div>}
      {error && <div className="text-[11px] text-destructive break-words">{error}</div>}
      {videoId && versions === null && !error && <div className="text-[11px] text-muted-foreground">Loading…</div>}
      {versions?.length === 0 && !error && (
        <div className="text-[11px] text-muted-foreground">No dataset versions yet — export/train to create one.</div>
      )}

      {versions?.map((v) => {
        const best = v.models.reduce<number>((m, r) => Math.max(m, r.metrics?.mAP50 ?? 0), -1);
        return (
          <div key={v.version_id} className="rounded-md border border-border p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-foreground truncate" title={v.version_id}>{v.version_id}</span>
              {v.stats && (
                <Badge variant="secondary" className="text-[10px] shrink-0">{v.stats.images} imgs · {v.stats.boxes} boxes</Badge>
              )}
            </div>
            {v.models.length === 0 && <div className="text-[10px] text-muted-foreground">no models trained yet</div>}
            {v.models
              .slice()
              .sort((a, b) => (b.metrics?.mAP50 ?? 0) - (a.metrics?.mAP50 ?? 0))
              .map((r) => {
                const map = r.metrics?.mAP50 ?? 0;
                return (
                  <div key={r.run_id} className="flex items-center gap-1.5 text-[11px]">
                    {map === best && map > 0 ? (
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                    ) : (
                      <Cpu className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate">{r.model}</span>
                    <span className="text-muted-foreground">· {r.epochs}ep</span>
                    <span className="ml-auto tabular-nums text-foreground">mAP50 {map.toFixed(3)}</span>
                  </div>
                );
              })}
          </div>
        );
      })}
    </Card>
  );
}
