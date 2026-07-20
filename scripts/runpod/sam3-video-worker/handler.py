"""RunPod serverless handler for SAM 3 VIDEO tracking (concept/text prompt).

Unlike the image worker (sam3-worker, per-frame detect), this runs SAM3's *video predictor*
with a memory bank: one text prompt on the first frame of a window, propagated across the
window so each object keeps its identity (a masklet).

Input  (job["input"]):  frames are PUSHED (RunPod can't reach the lab S3), 0-based window order
  { "frames_b64": ["<jpg/png b64>", ...],  # the window, in order; frame_index 0 = start_frame
    "start_frame": 0,                       # absolute index of frames_b64[0] (for output mapping)
    "text": "windsurf sail rig" }
  (fallback, only if the worker can reach it: {"video_url","start_frame","end_frame","fps","text"})
Output:
  { "frames": [ { "frame_number": <abs>,
                  "objects": [ {"object_id": int, "bbox":[x1,y1,x2,y2], "score": float,
                                "mask_base64": "<full-frame PNG>"} ] } ],
    "count": <n frames>, "image_size": [w, h] }

Weights: gated facebook/sam3 (endpoint env HF_TOKEN). Bounded window keeps GPU memory sane.
"""
import base64
import io
import os
import subprocess
import tempfile
import traceback

import runpod

_predictor = None

MAX_WINDOW = int(os.environ.get("SAM3_MAX_WINDOW", "120"))  # frames per call (GPU-memory bound)


def _load():
    global _predictor
    if _predictor is None:
        tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        if tok:
            os.environ["HF_TOKEN"] = tok
            os.environ["HUGGINGFACE_HUB_TOKEN"] = tok
        from sam3.model_builder import build_sam3_video_predictor

        # single-GPU serverless worker
        _predictor = build_sam3_video_predictor(gpus_to_use=[0])
    return _predictor


def _extract_window(video_url, start_frame, count, fps, out_dir):
    """Fast-seek + extract `count` frames starting at start_frame into out_dir as 0-based JPEGs."""
    ss = f"{(start_frame / fps):.3f}" if fps and fps > 0 else "0"
    cmd = [
        "ffmpeg", "-nostdin", "-loglevel", "error",
        "-ss", ss, "-i", video_url,
        "-frames:v", str(count), "-vsync", "0",
        "-start_number", "0", "-q:v", "2",
        os.path.join(out_dir, "%06d.jpg"),
    ]
    subprocess.run(cmd, capture_output=True, timeout=180, check=True)
    return sorted(f for f in os.listdir(out_dir) if f.endswith(".jpg"))


def _np(x):
    import numpy as np

    if hasattr(x, "detach"):
        x = x.detach().cpu().numpy()
    return np.asarray(x)


def _objects_from_output(out, W, H):
    """Turn a per-frame SAM3 video output dict into our object list.

    Session-path outputs carry: out_obj_ids, out_binary_masks, out_boxes_xywh (normalized xywh),
    out_probs. Be defensive about key names / tensor-vs-numpy.
    """
    import numpy as np

    if not isinstance(out, dict):
        return []
    ids = out.get("out_obj_ids", out.get("obj_ids"))
    masks = out.get("out_binary_masks", out.get("masks"))
    boxes = out.get("out_boxes_xywh", out.get("boxes"))
    probs = out.get("out_probs", out.get("scores"))
    if ids is None or masks is None:
        return []
    ids = _np(ids).reshape(-1)
    masks = _np(masks)
    boxes = _np(boxes) if boxes is not None else None
    probs = _np(probs).reshape(-1) if probs is not None else None

    objs = []
    for i, oid in enumerate(ids):
        m = masks[i]
        m = np.asarray(m)
        if m.ndim == 3:  # [1,H,W]
            m = m[0]
        binary = (m > 0.5)
        if binary.sum() == 0:
            continue
        ys, xs = np.where(binary)
        x1, y1, x2, y2 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
        if boxes is not None and i < len(boxes):  # prefer model box (normalized xywh -> px xyxy)
            bx, by, bw, bh = [float(v) for v in boxes[i]]
            x1, y1, x2, y2 = int(bx * W), int(by * H), int((bx + bw) * W), int((by + bh) * H)
        from PIL import Image

        im = Image.fromarray((binary.astype("uint8") * 255), mode="L")
        if im.size != (W, H):
            im = im.resize((W, H), Image.NEAREST)
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        objs.append({
            "object_id": int(oid),
            "bbox": [x1, y1, x2, y2],
            "score": float(probs[i]) if probs is not None and i < len(probs) else None,
            "mask_base64": base64.b64encode(buf.getvalue()).decode(),
        })
    return objs


def handler(job):
    tmp = None
    try:
        inp = job.get("input", {}) or {}
        text = inp.get("text") or inp.get("prompt")
        frames_b64 = inp.get("frames_b64")
        video_url = inp.get("video_url")
        if not text or not (frames_b64 or video_url):
            return {"error": "need input.text and either input.frames_b64 or input.video_url"}
        start_frame = int(inp.get("start_frame", 0))

        tmp = tempfile.mkdtemp(prefix="sam3vid_")
        frames_dir = os.path.join(tmp, "frames")
        os.makedirs(frames_dir, exist_ok=True)

        if frames_b64:  # primary: frames pushed from the in-cluster service (RunPod can't reach lab S3)
            frames_b64 = frames_b64[:MAX_WINDOW]
            for i, b in enumerate(frames_b64):
                with open(os.path.join(frames_dir, f"{i:06d}.jpg"), "wb") as fh:
                    fh.write(base64.b64decode(b))
            jpgs = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
        else:  # fallback: only works if the worker can reach video_url
            end_frame = int(inp.get("end_frame", start_frame + MAX_WINDOW - 1))
            fps = float(inp.get("fps", 30.0))
            count = max(1, min(end_frame - start_frame + 1, MAX_WINDOW))
            jpgs = _extract_window(video_url, start_frame, count, fps, frames_dir)
        if not jpgs:
            return {"error": "no frames to track (empty frames_b64 / ffmpeg produced nothing)"}
        from PIL import Image

        with Image.open(os.path.join(frames_dir, jpgs[0])) as im0:
            W, H = im0.size

        predictor = _load()
        import torch

        ctx = torch.autocast(device_type="cuda", dtype=torch.bfloat16) \
            if torch.cuda.is_available() else torch.autocast(device_type="cpu", dtype=torch.bfloat16)

        with ctx:
            r = predictor.handle_request(request=dict(type="start_session", resource_path=frames_dir))
            session_id = r["session_id"]
            seed = predictor.handle_request(request=dict(
                type="add_prompt", session_id=session_id, frame_index=0, text=text))
            per_frame = {0: seed.get("outputs", seed)}
            for resp in predictor.handle_stream_request(request=dict(
                    type="propagate_in_video", session_id=session_id)):
                per_frame[resp["frame_index"]] = resp["outputs"]
            try:
                predictor.handle_request(request=dict(type="close_session", session_id=session_id))
            except Exception:
                pass

        out_frames = []
        for local_idx in sorted(per_frame):
            objs = _objects_from_output(per_frame[local_idx], W, H)
            out_frames.append({"frame_number": start_frame + int(local_idx), "objects": objs})
        return {"frames": out_frames, "count": len(out_frames), "image_size": [W, H]}
    except subprocess.CalledProcessError as e:
        return {"error": f"ffmpeg failed: {e.stderr[-500:].decode(errors='replace') if e.stderr else e}"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1800:]}
    finally:
        if tmp:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


runpod.serverless.start({"handler": handler})
