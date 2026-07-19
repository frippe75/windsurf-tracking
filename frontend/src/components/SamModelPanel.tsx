import { useEffect, useMemo, useState } from "react";

/**
 * SAM model selector + concept (text-prompt) tester.
 *
 * Reads the model fleet from the pipeline_service (same-origin /pipeline), lets you pick
 * a segmentation model (Off / SAM2 / SAM3, local or external — whatever is registered),
 * and for a concept-segment model (SAM3) runs a TEXT prompt on the current video frame and
 * draws the returned boxes. This is the on/off + v2/v3 + local/external toggle, live.
 */
const PIPELINE = "/pipeline";

type ModelInfo = { name: string; capabilities: string[] };

export function SamModelPanel() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<string>(() => localStorage.getItem("samModel") || "off");
  const [prompt, setPrompt] = useState("windsurf sail rig");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [dets, setDets] = useState<any[] | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch(`${PIPELINE}/models`)
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch((e) => setErr(`GET /pipeline/models: ${e}`));
  }, []);
  useEffect(() => localStorage.setItem("samModel", selected), [selected]);

  const segModels = useMemo(
    () => models.filter((m) => m.capabilities.some((c) => c === "concept-segment" || c === "segment-click")),
    [models],
  );
  const isConcept = models.find((m) => m.name === selected)?.capabilities.includes("concept-segment");

  function grabFrameB64(): string {
    const video = document.querySelector("video") as HTMLVideoElement | null;
    if (!video || !video.videoWidth) {
      throw new Error("No video frame — load a video and make sure a frame is visible.");
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0);
    try {
      return c.toDataURL("image/png").split(",")[1];
    } catch (e) {
      throw new Error(`Can't read the video pixels (cross-origin/tainted canvas): ${e}`);
    }
  }

  // a 200x200 black frame with a white square — lets you verify SAM3 without a video
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
    try {
      const b64 = useTest ? testFrameB64() : grabFrameB64();
      const text = useTest ? "white square" : prompt;
      const r = await fetch(`${PIPELINE}/segment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selected, inputs: { image_png_base64: b64, text } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}: ${JSON.stringify(d)}`);
      setDets(d.result?.detections ?? []);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("[SamModelPanel]", e);
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

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
            title="Runs SAM3 on a built-in black frame with a white square — verifies the path without a video"
          >
            Test (built-in image)
          </button>
        </>
      )}
      {selected !== "off" && !isConcept && (
        <div className="text-slate-400">Click-based segmentation — click on the video (SAM2 flow).</div>
      )}

      {err && <div className="mt-2 break-words text-red-400">{err}</div>}
      {dets && (
        <div className="mt-2">
          <div className="text-emerald-400">{dets.length} detection(s)</div>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 p-1">
            {JSON.stringify(dets.map((d) => ({ bbox: d.bbox?.map((v: number) => Math.round(v)), score: d.score?.toFixed?.(2) })), null, 1)}
          </pre>
        </div>
      )}
      <div className="mt-2 text-[10px] text-slate-500">via /pipeline · fleet from models.yaml</div>
    </div>
  );
}
