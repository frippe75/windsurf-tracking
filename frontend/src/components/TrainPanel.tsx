import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, ChevronDown, ChevronRight } from "lucide-react";
import { startTraining, getTrainingStatus, type TrainStatus } from "@/lib/pipelineApi";

// Weights the ultralytics image can pull by name. nano = fast default for a single-class detector.
const MODELS = [
  { value: "yolov8n.pt", label: "YOLOv8-n (fast)" },
  { value: "yolov8s.pt", label: "YOLOv8-s" },
  { value: "yolov8m.pt", label: "YOLOv8-m (slow)" },
  { value: "yolo11n.pt", label: "YOLO11-n" },
  { value: "yolo11s.pt", label: "YOLO11-s" },
];

/**
 * Train tab: train a YOLO on the current dataset and show eval metrics (mAP). It reuses the
 * existing export flow (which saves annotations to the backend + builds the train/val zip) to get
 * a dataset URL, then kicks off a k8s GPU Job via pipeline-service and polls for metrics.
 * The north-star signal of the dataset flywheel — "is the data good?" = downstream mAP.
 */
type Props = {
  projectId: string;
  canTrain: boolean; // classes + annotations present
  getDatasetUrl: (onProgress?: (done: number, total: number) => void) => Promise<string>; // exports + returns the dataset zip URL
};

const TERMINAL = new Set(["succeeded", "failed"]);

function Bar({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="truncate">{label}</span>
        <span className="text-foreground tabular-nums">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-muted">
        <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color || "hsl(217, 91%, 60%)" }} />
      </div>
    </div>
  );
}

export function TrainPanel({ projectId, canTrain, getDatasetUrl }: Props) {
  const storeKey = `train:${projectId}`;
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem(`train:${projectId}`));
  const [epochs, setEpochs] = useState(50);
  const [model, setModel] = useState(MODELS[0].value);
  const [imgsz, setImgsz] = useState(640);
  const [showTuning, setShowTuning] = useState(false);
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "exporting" | "polling">("idle");
  const [exportProg, setExportProg] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false); // synchronous re-entry guard for the Train button

  const persist = useCallback(
    (id: string | null) => {
      setJobId(id);
      if (id) localStorage.setItem(storeKey, id);
      else localStorage.removeItem(storeKey);
    },
    [storeKey],
  );

  // Poll while a job is active.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let fails = 0;
    const tick = async () => {
      try {
        const s = await getTrainingStatus(jobId);
        if (cancelled) return;
        fails = 0;
        setStatus(s);
        setError("");
        if (!TERMINAL.has(s.status)) {
          timer.current = setTimeout(tick, 5000);
        }
      } catch (e: any) {
        if (cancelled) return;
        // Tolerate transient network blips — keep polling; only surface after a run of failures.
        if (++fails >= 8) {
          setError(String(e?.message ?? e));
        } else {
          timer.current = setTimeout(tick, 5000);
        }
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId]);

  const train = async () => {
    // Synchronous guard: `busy` is state-based and lags a render, so a fast double-click could
    // fire two exports/trainings before the button disables. This blocks re-entry immediately.
    if (startingRef.current || busy) return;
    startingRef.current = true;
    setError("");
    setStatus(null);
    setExportProg(null);
    setPhase("exporting");
    try {
      const dataset_url = await getDatasetUrl((done, total) => setExportProg({ done, total }));
      setPhase("polling");
      const { job_id } = await startTraining({ dataset_url, project_id: projectId, epochs, model, imgsz });
      persist(job_id);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase("idle");
    } finally {
      startingRef.current = false;
    }
  };

  const busy = phase === "exporting" || (!!status && !TERMINAL.has(status.status)) || (!!jobId && !status);
  const m = status?.metrics;

  return (
    <Card className="p-4 bg-card border-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Train YOLO</h3>
        {status && (
          <Badge variant={status.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
            {status.status}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowTuning((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {showTuning ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Tuning
        </button>
        <span className="text-[10px] text-muted-foreground/70">{MODELS.find((m) => m.value === model)?.label} · {epochs}ep · {imgsz}px</span>
        <Button size="sm" className="ml-auto h-7" disabled={!canTrain || busy} onClick={train}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span className="ml-1">{busy ? (phase === "exporting" ? "Exporting…" : "Training…") : "Train"}</span>
        </Button>
      </div>

      {showTuning && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 rounded-md border border-border p-2">
          <label className="text-[11px] text-muted-foreground">model</label>
          <select
            value={model}
            disabled={busy}
            onChange={(e) => setModel(e.target.value)}
            className="h-7 rounded border border-input bg-background px-1 text-xs"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <label className="text-[11px] text-muted-foreground">epochs</label>
          <input
            type="number" min={1} max={300} value={epochs} disabled={busy}
            onChange={(e) => setEpochs(Math.max(1, Math.min(300, Number(e.target.value) || 1)))}
            className="h-7 w-20 rounded border border-input bg-background px-2 text-xs"
          />
          <label className="text-[11px] text-muted-foreground">image size</label>
          <select
            value={imgsz}
            disabled={busy}
            onChange={(e) => setImgsz(Number(e.target.value))}
            className="h-7 w-24 rounded border border-input bg-background px-1 text-xs"
          >
            {[416, 512, 640, 768, 960, 1280].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {!canTrain && <div className="text-[11px] text-muted-foreground">Add classes + annotations before training.</div>}
      {error && <div className="text-[11px] text-destructive break-words">{error}</div>}

      {phase === "exporting" && (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Exporting dataset</span>
            {exportProg && <span className="tabular-nums">{exportProg.done}/{exportProg.total} images</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary transition-all"
              style={{ width: exportProg ? `${(exportProg.done / Math.max(1, exportProg.total)) * 100}%` : "8%" }}
            />
          </div>
        </div>
      )}

      {busy && !m && phase !== "exporting" && !status?.progress && (
        <div className="text-[11px] text-muted-foreground">Starting on a GPU node (cold start + model load)…</div>
      )}

      {status?.status === "running" && status.progress && (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">epoch {status.progress.epoch}/{status.progress.total_epochs}</span>
            <span className="tabular-nums">mAP@50 {status.progress.mAP50.toFixed(3)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary transition-all"
              style={{ width: `${(status.progress.epoch / Math.max(1, status.progress.total_epochs)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {m && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="text-[11px] text-muted-foreground">
            Eval ({m.epochs} epochs{m.num_images ? ` · ${m.num_images} images` : ""})
          </div>
          <Bar label="mAP@50" value={m.mAP50} color="hsl(142, 71%, 45%)" />
          <Bar label="mAP@50-95" value={m.mAP50_95} color="hsl(160, 71%, 42%)" />
          <div className="text-[11px] text-muted-foreground pt-1">Per class (AP@50-95)</div>
          {m.per_class.map((c) => (
            <Bar key={c.class} label={c.class} value={c.ap50_95} />
          ))}
        </div>
      )}

      {status?.status === "succeeded" && (
        <div className="text-[10px] text-muted-foreground">best.pt saved to the dataset store — servable as a detector next.</div>
      )}
    </Card>
  );
}
