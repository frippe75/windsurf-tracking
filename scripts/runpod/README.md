# RunPod serverless VLM endpoint

Brings up the sail brand/model VLM (`vlm_extract` stage) as a **RunPod serverless**
endpoint that speaks the **OpenAI-compatible** API, so it plugs straight into
`pipeline_engine`'s `openai-compat-http` handle (see `docs/PIPELINE_ARCHITECTURE.md` §5b).

Why RunPod and not the lab GPUs: the lab pool is 15× Tesla **T4 (Turing)**, and vLLM's
VLM *vision* path isn't Turing-supported (vllm#29743) — so the VLM needs an **Ampere+**
GPU, which RunPod provides on demand. Serverless **scale-to-zero** fits bursty per-click
inference: you pay per second of use, and `IDLE_TIMEOUT` controls how long the model
stays warm before it unloads.

This replicates the GraphQL `saveTemplate`+`saveEndpoint` pattern from the
`frippe75/aide-poc` FaaS scripts, but targets RunPod's official **vLLM worker** image
(exposes `/openai/v1`) — so there's **no custom handler and no Docker build**.

## 1. Get an API key (how the token is obtained)

1. RunPod dashboard → **Settings → API Keys** → create a key (read/write).
2. Store it the way the repo scripts expect:
   ```bash
   mkdir -p ~/.runpod && umask 077
   printf '%s' 'rpa_your_key_here' > ~/.runpod/api_key   # chmod 600
   ```
   (Or `export RUNPOD_API_KEY=...`, or set `RUNPOD_API_KEY_FILE`.) The key is **never**
   committed. For gated HF models, add an `HF_TOKEN` — for `InternVL3.5-8B` it's not needed
   (Apache-2.0). Cloud creds, if ever needed, go in RunPod dashboard → **Secrets**
   (mounted at `/runpod/secrets/…`).

## 2. Create the endpoint

```bash
cp scripts/runpod/.env.example scripts/runpod/.env   # tweak GPU/model/idle-timeout
./scripts/runpod/create-vlm-endpoint.sh
```

Prints the endpoint id + the `openai_base_url` and writes `runpod-vlm-endpoint.json`.

## 3. Wire it into the engine

```python
from pipeline_engine.models import MODELS, ModelConfig
MODELS.configure("sail-vlm", ModelConfig(            # stable *logical* name
    type="openai-compat-http",
    model_name="QuantTrio/Qwen3-VL-32B-Instruct-AWQ",  # the served model (from the endpoint)
    base_url="https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1",
    auth_env="RUNPOD_API_KEY",   # read at call time; never stored in config
))
```

The `sail-brand-model` pipeline references `model: sail-vlm` and needs no change when you
swap the concrete model/endpoint. To run the full pipeline against the live endpoint:

```bash
RUNPOD_API_KEY=$(cat ~/.runpod/api_key) python3 scripts/runpod/run_sail_pipeline_live.py
```

## The unload timer

`IDLE_TIMEOUT` (seconds) = how long a worker stays warm after the last request before it
scales down and the model unloads. Default **600s (10 min)** keeps it warm through gaps in
a labeling session while still scaling to zero afterwards. Lower it (e.g. 300) to save
cost at the price of more cold starts; set `WORKERS_MIN=1` during active work to eliminate
cold starts entirely (at the cost of a pinned GPU).

## Cold-start cost / network volume (TODO)

With no network volume, each cold start re-downloads the model to ephemeral disk
(`CONTAINER_DISK_GB`) — ~20 GB for the 32B AWQ, ~40 GB for the 72B fallback — adding
minutes and bandwidth every time the endpoint scales from zero. For production, attach a
RunPod **network volume** (mount the HF cache) so the model is downloaded once. `IDLE_TIMEOUT`
(default 600s) keeps it warm between clicks so this only bites after a long idle.

## Notes / verify against current RunPod docs

- `VLM_IMAGE` / env var names (`MODEL_NAME`, `QUANTIZATION`, `MAX_MODEL_LEN`,
  `TRUST_REMOTE_CODE`) follow RunPod's vLLM worker; pin a concrete image tag and confirm
  the env names against the current worker README before a production run.
- `gpuIds`/`scalerType` values (`AMPERE_24`, `QUEUE_DELAY`) match the working
  `aide-poc` scripts. Adjust GPU class to the model's VRAM needs.
- The script only *creates* the endpoint (a paid resource) — it makes no inference calls.
