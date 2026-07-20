import { useEffect, useMemo, useState } from "react";

/**
 * SAM model selector + concept (text-prompt) tester.
 *
 * Reads the model fleet from the pipeline_service (same-origin /pipeline), lets you pick a
 * segmentation model (Off / SAM2 / SAM3, local or external), and for a concept-segment model
 * (SAM3) runs a TEXT prompt on the current video frame and draws the returned boxes.
 *
 * The frame is extracted SERVER-SIDE (we send the video url + timestamp): the app's video is a
 * cross-origin presigned URL, so reading its pixels in the browser is blocked (tainted canvas).
 */
const PIPELINE = "/pipeline";

type ModelInfo = { name: string; capabilities: string[] };
type Box = { left: number; top: number; width: number; height: number; score?: number };
type Detection = { bbox: number[]; score?: number; mask_base64?: string };
type Props = { onAddDetections?: (dets: Detection[]) => number };

export function SamModelPanel({ onAddDetections }: Props = {}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<string>(() => localStorage.getItem("samModel") || "off");
  const [prompt, setPrompt] = useState("windsurf sail rig");
  const [minScore, setMinScore] = useState(() => {
    const v = parseFloat(localStorage.getItem("samMinScore") || "0.5");
    return Number.isFinite(v) ? v : 0.5;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [dets, setDets] = useState<any[] | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [kept, setKept] = useState<Detection[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch(`${PIPELINE}/models`)
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch((e) => setErr(`GET /pipeline/models: ${e}`));
  }, []);
  useEffect(() => localStorage.setItem("samModel", selected), [selected]);
  useEffect(() => localStorage.setItem("samMinScore", String(minScore)), [minScore]);

  const segModels = useMemo(
    () => models.filter((m) => m.capabilities.some((c) => c === "concept-segment" || c === "segment-click")),
    [models],
  );
  const isConcept = models.find((m) => m.name === selected)?.capabilities.includes("concept-segment");

  function testFrameB64(): string {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "black";
    g.fillRect(0, 0, 200, 200);
    g.fillStyle = "white";
    g.fillRect(60, 60, 80, 80);
    return c.toDataURL("image/png").split(",")[1];
  }

  async function runConcept(useTest = false) {
    setBusy(true);
    setErr("");
    setDets(null);
    setBoxes([]);
    setKept([]);
    try {
      let inputs: Record<string, unknown>;
      let vidEl: HTMLVideoElement | null = null;
      if (useTest) {
        inputs = { image_png_base64: testFrameB64(), text: "white square" };
      } else {
        vidEl = document.querySelector("video") as HTMLVideoElement | null;
        const vid = (window as unknown as { __samVideoId?: string }).__samVideoId;
        if (!vidEl || !vidEl.videoWidth) {
          throw new Error("Load a video first (and make sure a frame is showing).");
        }
        if (!vid) throw new Error("No video id yet — open a video in a project first.");
        // send the id (the service resolves the real stream URL); the <video> only has a blob: src
        inputs = { video_id: vid, time_sec: vidEl.currentTime, text: prompt };
      }
      const r = await fetch(`${PIPELINE}/segment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selected, inputs }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}: ${JSON.stringify(d)}`);
      const detections: any[] = d.result?.detections ?? [];
      setDets(detections);
      const keptDets: Detection[] = detections
        .filter((x) => Array.isArray(x.bbox) && x.bbox.length === 4)
        .filter((x) => (x.score ?? 0) >= minScore);
      setKept(keptDets);
      if (vidEl && vidEl.videoWidth) {
        const rect = vidEl.getBoundingClientRect();
        const sx = rect.width / vidEl.videoWidth;
        const sy = rect.height / vidEl.videoHeight;
        setBoxes(
          keptDets.map((x) => {
            const [x1, y1, x2, y2] = x.bbox as number[];
            return {
              left: rect.left + x1 * sx,
              top: rect.top + y1 * sy,
              width: (x2 - x1) * sx,
              height: (y2 - y1) * sy,
              score: x.score,
            };
          }),
        );
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("[SamModelPanel]", e);
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const overlay =
    boxes.length > 0 ? (
      <div className="pointer-events-none fixed inset-0 z-40">
        {boxes.map((b, i) => (
          <div
            key={i}
            className="absolute border-2 border-emerald-400"
            style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          >
            <span className="absolute -top-4 left-0 bg-emerald-500 px-1 text-[10px] text-black">
              {b.score != null ? b.score.toFixed(2) : ""}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-50 rounded bg-slate-800 px-2 py-1 text-xs text-white shadow"
      >
        SAM ▸
      </button>
    );
  }

  return (
    <>
      {overlay}
      <div className="fixed bottom-3 right-3 z-50 w-72 rounded-lg border border-slate-600 bg-slate-900/95 p-3 text-xs text-slate-100 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">SAM model (experimental)</span>
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <label className="mb-1 block text-slate-400">Segmentation</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mb-2 w-full rounded bg-slate-800 px-2 py-1"
        >
          <option value="off">Off</option>
          {segModels.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} — {m.capabilities.join(", ")}
            </option>
          ))}
        </select>

        {isConcept && (
          <>
            <label className="mb-1 block text-slate-400">Text prompt (concept)</label>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mb-2 w-full rounded bg-slate-800 px-2 py-1"
            />
            <label className="mb-1 flex items-center justify-between text-slate-400">
              <span>Min score</span>
              <span className="text-slate-300">{minScore.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value))}
              className="mb-2 w-full"
            />
            <button
              onClick={() => runConcept(false)}
              disabled={busy}
              className="mb-1 w-full rounded bg-emerald-600 px-2 py-1 font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Detecting… (cold start ~1–4 min)" : "Detect on current frame"}
            </button>
            <button
              onClick={() => runConcept(true)}
              disabled={busy}
              className="w-full rounded bg-slate-700 px-2 py-1 hover:bg-slate-600 disabled:opacity-50"
              title="Runs SAM3 on a built-in white-square frame — verifies the path without a video"
            >
              Test (built-in image)
            </button>
          </>
        )}
        {selected !== "off" && !isConcept && (
          <div className="text-slate-400">Click-based (SAM2): click on the video canvas.</div>
        )}

        {err && <div className="mt-2 break-words text-red-400">{err}</div>}
        {onAddDetections && kept.length > 0 && (
          <button
            onClick={() => {
              const n = onAddDetections(kept);
              if (n > 0) {
                // they're real canvas annotations now — drop the fixed preview overlay
                setBoxes([]);
                setKept([]);
              }
            }}
            className="mb-1 w-full rounded bg-sky-600 px-2 py-1 font-medium hover:bg-sky-500"
          >
            Add {kept.length} as object{kept.length > 1 ? "s" : ""} (frame)
          </button>
        )}

        {dets && (
          <div className="mt-2">
            <div className="text-emerald-400">
              {dets.length} detection(s) · {boxes.length} ≥ {minScore.toFixed(2)}
              {boxes.length > 0 ? " drawn" : ""}
            </div>
            <pre className="mt-1 max-h-28 overflow-auto rounded bg-black/40 p-1">
              {JSON.stringify(dets.map((d) => ({ bbox: d.bbox?.map((v: number) => Math.round(v)), score: d.score?.toFixed?.(2) })), null, 1)}
            </pre>
          </div>
        )}
        <div className="mt-2 text-[10px] text-slate-500">via /pipeline · frame extracted server-side</div>
      </div>
    </>
  );
}
