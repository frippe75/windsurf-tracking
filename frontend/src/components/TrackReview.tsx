import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { Annotation, Track, ThinOp } from "@/types/annotation";
import { keptIds } from "@/lib/applyThinning";

/**
 * Track review + non-destructive thinning. Lists SAM3 tracks; per track you stack thinning ops
 * (every-Nth, scale-change, min-score, max-per-track), applied in order. `excluded` is recomputed
 * (never deleted), so removing ops restores frames; export omits excluded ones.
 */
type Props = {
  tracks: Track[];
  annotations: Annotation[];
  onUpdateThinning: (trackId: string, ops: ThinOp[]) => void;
};

const opLabel = (op: ThinOp): string => {
  switch (op.kind) {
    case "everyN": return `every ${op.n}`;
    case "minScaleDeltaPct": return `scale ≥ ${op.pct}%`;
    case "minScore": return `score ≥ ${op.v}`;
    case "maxPerTrack": return `max ${op.k}`;
  }
};

export function TrackReview({ tracks, annotations, onUpdateThinning }: Props) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const annsFor = (id: string) => annotations.filter((a) => a.trackId === id);

  if (tracks.length === 0) {
    return (
      <Card className="p-4 bg-card border-border">
        <h3 className="text-sm font-semibold mb-1">Tracks</h3>
        <p className="text-xs text-muted-foreground">No tracks yet. Run a Track from the Detect tool to review &amp; thin it here.</p>
      </Card>
    );
  }

  const selected = tracks.find((t) => t.id === selectedId);

  return (
    <Card className="p-4 bg-card border-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tracks</h3>
        <Badge variant="secondary">{tracks.length}</Badge>
      </div>

      <div className="space-y-1">
        {tracks.map((t) => {
          const total = annsFor(t.id).length;
          const kept = keptIds(annsFor(t.id), t.thinning).size;
          const isSel = t.id === selectedId;
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(isSel ? undefined : t.id)}
              className={`w-full text-left p-2 rounded hover:bg-muted/50 transition-colors ${isSel ? "bg-muted" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium">{t.prompt || "track"}</span>
                <Badge variant={kept < total ? "default" : "secondary"} className="text-[10px] flex-shrink-0">{kept}/{total}</Badge>
              </div>
              <div className="text-[10px] text-muted-foreground">
                frames {t.startFrame}–{t.endFrame}{t.thinning.length ? ` · ${t.thinning.length} op(s)` : ""}
              </div>
            </button>
          );
        })}
      </div>

      {selected && <ThinEditor track={selected} onUpdate={(ops) => onUpdateThinning(selected.id, ops)} />}
    </Card>
  );
}

function ThinEditor({ track, onUpdate }: { track: Track; onUpdate: (ops: ThinOp[]) => void }) {
  const [everyN, setEveryN] = useState(10);
  const [scalePct, setScalePct] = useState(20);
  const [minScore, setMinScore] = useState(0.5);
  const [maxK, setMaxK] = useState(20);
  const add = (op: ThinOp) => onUpdate([...track.thinning, op]);
  const removeAt = (i: number) => onUpdate(track.thinning.filter((_, idx) => idx !== i));

  return (
    <div className="border-t border-border pt-2 space-y-2">
      <div className="text-[11px] text-muted-foreground">Thinning — applied in order, reversible</div>

      {track.thinning.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {track.thinning.map((op, i) => (
            <span key={i} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
              {opLabel(op)}
              <button onClick={() => removeAt(i)} className="text-muted-foreground hover:text-foreground" title="Remove">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button onClick={() => onUpdate([])} className="text-[10px] text-muted-foreground underline">clear</button>
        </div>
      )}

      <div className="space-y-1">
        <AddRow label="Every Nth" value={everyN} setValue={setEveryN} min={1} onAdd={() => add({ kind: "everyN", n: Math.max(1, Math.round(everyN)) })} />
        <AddRow label="Scale ≥ %" value={scalePct} setValue={setScalePct} min={0} onAdd={() => add({ kind: "minScaleDeltaPct", pct: Math.max(0, scalePct) })} />
        <AddRow label="Min score" value={minScore} setValue={setMinScore} min={0} step={0.05} onAdd={() => add({ kind: "minScore", v: minScore })} />
        <AddRow label="Max /track" value={maxK} setValue={setMaxK} min={1} onAdd={() => add({ kind: "maxPerTrack", k: Math.max(1, Math.round(maxK)) })} />
      </div>
    </div>
  );
}

function AddRow(props: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  onAdd: () => void;
  min?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-16 text-[10px] text-muted-foreground">{props.label}</span>
      <Input
        type="number"
        value={props.value}
        min={props.min}
        step={props.step}
        onChange={(e) => props.setValue(parseFloat(e.target.value) || 0)}
        className="h-6 w-14 px-1 text-[10px]"
      />
      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={props.onAdd}>Add</Button>
    </div>
  );
}
