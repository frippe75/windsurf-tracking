"""RunPod serverless handler for SAM 3 concept (text-prompt) segmentation.

Input  (job["input"]):
  { "image_base64": "<png/jpg b64>", "text": "windsurf sail" }
Output:
  { "detections": [ {"bbox":[x1,y1,x2,y2], "score":0.93}, ... ],
    "count": N, "image_size": [w,h] }

The heavy model loads once on cold start. Weights come from the gated HF repo, so the
endpoint must have HF_TOKEN set (RunPod env var) with approved access to facebook/sam3.1.
"""
import base64
import io
import os
import traceback

import runpod

_processor = None


def _tolist(x):
    try:
        return x.detach().cpu().tolist()
    except Exception:
        try:
            return x.tolist()
        except Exception:
            return list(x)


def _load():
    global _processor
    if _processor is None:
        # token for gated weights (env set on the endpoint)
        tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        if tok:
            os.environ["HF_TOKEN"] = tok
            os.environ["HUGGINGFACE_HUB_TOKEN"] = tok
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor

        model = build_sam3_image_model()
        # default 0.5 over-filters small/low-confidence objects; expose it (env-tunable)
        conf = float(os.environ.get("SAM3_CONF", "0.1"))
        _processor = Sam3Processor(model, confidence_threshold=conf)
    return _processor


def handler(job):
    try:
        inp = job.get("input", {}) or {}
        text = inp.get("text") or inp.get("prompt")
        img_b64 = inp.get("image_base64")
        if not text or not img_b64:
            return {"error": "need input.image_base64 and input.text"}

        from PIL import Image

        img = Image.open(io.BytesIO(base64.b64decode(img_b64))).convert("RGB")
        proc = _load()
        import torch

        # SAM3 runs inference under a bf16 autocast context (see its sam3_base_predictor);
        # the raw Sam3Processor path needs the caller to provide it, else fp32/bf16 mismatch.
        ctx = (
            torch.autocast(device_type="cuda", dtype=torch.bfloat16)
            if torch.cuda.is_available()
            else torch.autocast(device_type="cpu", dtype=torch.bfloat16)
        )
        with ctx:
            state = proc.set_image(img)
            out = proc.set_text_prompt(state=state, prompt=text)

        boxes = _tolist(out["boxes"]) if out.get("boxes") is not None else []
        scores = _tolist(out["scores"]) if out.get("scores") is not None else []

        # SAM3 also returns per-object masks (bool, shape [N,1,H,W] at original image size).
        # Encode each as a full-frame 1-bit PNG so the annotation renders a real silhouette
        # (the frontend tints white pixels with the class color; maskIsCropped=false → drawn
        # over the whole frame). Guard the whole thing so a mask hiccup never drops detections.
        masks_np = None
        try:
            m = out.get("masks")
            if m is None:
                m = out.get("masks_logits")
            if m is not None:
                import numpy as np

                arr = m.detach().cpu().numpy() if hasattr(m, "detach") else np.asarray(m)
                if arr.ndim == 4:      # [N,1,H,W] -> [N,H,W]
                    arr = arr[:, 0]
                elif arr.ndim == 2:    # [H,W] -> [1,H,W]
                    arr = arr[None]
                masks_np = arr
        except Exception:
            masks_np = None

        def _mask_png_b64(i):
            if masks_np is None or i >= len(masks_np):
                return None
            try:
                import numpy as np

                a = masks_np[i]
                binary = (a > 0.5).astype("uint8") * 255  # bool or logits both ok
                im = Image.fromarray(binary, mode="L")
                if im.size != (img.width, img.height):
                    im = im.resize((img.width, img.height), Image.NEAREST)
                buf = io.BytesIO()
                im.save(buf, format="PNG", optimize=True)
                return base64.b64encode(buf.getvalue()).decode()
            except Exception:
                return None

        dets = []
        for i, b in enumerate(boxes):
            s = scores[i] if i < len(scores) else None
            det = {"bbox": b, "score": s}
            mb = _mask_png_b64(i)
            if mb:
                det["mask_base64"] = mb
            dets.append(det)
        return {"detections": dets, "count": len(dets), "image_size": [img.width, img.height]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}


runpod.serverless.start({"handler": handler})
