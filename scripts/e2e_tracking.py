#!/usr/bin/env python3
"""
End-to-end tracking journey against the DEPLOYED API.

One ordered journey with per-stage logging and a guaranteed teardown (a mid-stage
failure still deletes everything it created). Uploads a tiny synthetic clip (a
white square moving across a black background — a clean SAM2 target), runs the
real tracking pipeline, and asserts tolerance-based invariants (job completes, a
mask/bbox per frame, the bbox actually MOVES with the square and isn't full-frame)
— never exact bboxes, which flake across SAM2 versions/hardware.

Run:  E2E_PASSWORD=... python scripts/e2e_tracking.py --base https://windsurf-api.tclab.org
Exit: 0 = pass, 1 = fail. Nightly-schedule this (see .gitlab-ci.yml e2e-tracking-nightly).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[1] / "backend/tests/e2e/fixtures/moving_square.mp4"


def _req(method, url, token=None, json_body=None, raw_body=None, content_type=None, timeout=60):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    elif raw_body is not None:
        data = raw_body
        if content_type:
            headers["Content-Type"] = content_type
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        body = resp.read()
        return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            body = json.loads(body)
        except Exception:
            body = body.decode(errors="replace")[:200]
        return e.code, body


def _multipart(fields_file_path, field_name="file", content_type="video/mp4"):
    """Build a minimal multipart/form-data body for a single file field."""
    boundary = "----e2e" + uuid.uuid4().hex
    filename = os.path.basename(fields_file_path)
    with open(fields_file_path, "rb") as f:
        file_bytes = f.read()
    pre = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode()
    post = f"\r\n--{boundary}--\r\n".encode()
    return pre + file_bytes + post, f"multipart/form-data; boundary={boundary}"


def _centroid_area(bbox):
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0), abs((x2 - x1) * (y2 - y1))


def run(base, email, password, timeout):
    ctx = {}
    base = base.rstrip("/")

    def stage(name):
        print(f"▶ {name}", flush=True)

    # 1) login
    stage("login")
    s, tok = _req("POST", f"{base}/auth/login", json_body={"email": email, "password": password})
    assert s == 200, f"login failed ({s}): {tok}"
    token = tok["access_token"]

    # 2) upload a throwaway clip (create_project needs the video to exist first)
    stage("upload_video")
    body, ctype = _multipart(str(FIXTURE))
    s, up = _req("POST", f"{base}/api/videos/upload", token=token, raw_body=body,
                 content_type=ctype, timeout=120)
    assert s == 200, f"upload failed ({s}): {up}"
    ctx["video_id"] = up["video_id"]
    vw, vh = up.get("width", 320), up.get("height", 240)
    print(f"  video_id={ctx['video_id']} {vw}x{vh}")

    # 3) create project
    stage("create_project")
    s, proj = _req("POST", f"{base}/api/projects", token=token, json_body={
        "name": f"e2e-{uuid.uuid4().hex[:8]}", "description": "e2e journey",
        "video_id": ctx["video_id"]})
    assert s == 200, f"create_project failed ({s}): {proj}"
    ctx["project_id"] = proj["id"]

    # 4) create a real class
    stage("create_class")
    s, cls = _req("POST", f"{base}/api/projects/{ctx['project_id']}/classes", token=token,
                  json_body={"name": "square", "color": "#e11"})
    assert s == 200, f"create_class failed ({s}): {cls}"
    ctx["class_id"] = cls["id"]

    # 5) create + run tracking job — click the square at frame 0 (~center 54,54)
    stage("create_tracking_job")
    click = {"x": 54, "y": 54, "type": "positive"}
    s, job = _req("POST", f"{base}/api/videos/{ctx['video_id']}/tracking/jobs", token=token,
                  json_body={"segments": [{"start_frame": 0, "end_frame": 20,
                                           "click_prompts": [click]}]})
    assert s == 200, f"create job failed ({s}): {job}"
    assert "single_job" in job, f"expected single_job, got: {job}"
    job_id = job["single_job"]["job_id"]

    stage("execute")
    s, ex = _req("POST", f"{base}/api/tracking/jobs/{job_id}/execute", token=token, json_body={})
    assert s == 200, f"execute failed ({s}): {ex}"

    # 6) poll to completion
    stage("poll")
    deadline = time.time() + timeout
    status = None
    while time.time() < deadline:
        time.sleep(3)
        s, status = _req("GET", f"{base}/api/tracking/jobs/{job_id}/status", token=token)
        assert s == 200, f"status failed ({s}): {status}"
        if status.get("status") in ("completed", "failed"):
            break
    assert status and status.get("status") == "completed", \
        f"job did not complete in {timeout}s (last: {status})"

    # 7) assert results — tolerance-based invariants, not exact bboxes
    stage("assert_results")
    s, res = _req("GET", f"{base}/api/tracking/jobs/{job_id}/results", token=token)
    assert s == 200, f"results failed ({s}): {res}"
    frames = (res.get("results") or {}).get("frames") or []
    with_bbox = [f for f in frames if f.get("bboxes")]
    assert len(with_bbox) >= 15, f"expected >=15 tracked frames, got {len(with_bbox)}"
    assert all(f.get("masks_base64") for f in with_bbox), "some frames have a bbox but no mask"

    first, last = with_bbox[0]["bboxes"][0], with_bbox[-1]["bboxes"][0]
    (cx0, cy0), area0 = _centroid_area(first)
    (cx1, cy1), _ = _centroid_area(last)
    frame_area = vw * vh
    # the square moves right+down; the tracked bbox must follow it, meaningfully
    assert cx1 > cx0 + 40, f"bbox did not move right (x {cx0:.0f}->{cx1:.0f})"
    assert cy1 > cy0 + 20, f"bbox did not move down (y {cy0:.0f}->{cy1:.0f})"
    # and must be an object, not a full-frame mask
    assert area0 < 0.5 * frame_area, f"first bbox is full-frame-ish (area {area0:.0f}/{frame_area})"
    print(f"  tracked {len(with_bbox)} frames; centroid ({cx0:.0f},{cy0:.0f})->({cx1:.0f},{cy1:.0f}) ✓")

    return ctx


def teardown(base, email, password, ctx):
    """Best-effort cleanup — runs even if a stage failed."""
    base = base.rstrip("/")
    s, tok = _req("POST", f"{base}/auth/login", json_body={"email": email, "password": password})
    if s != 200:
        print(f"⚠ teardown: could not log in to clean up ({s}); leaked: {ctx}")
        return
    token = tok["access_token"]
    pid, cid, vid = ctx.get("project_id"), ctx.get("class_id"), ctx.get("video_id")
    if pid and cid:
        _req("DELETE", f"{base}/api/projects/{pid}/classes/{cid}", token=token)
    if pid:
        _req("DELETE", f"{base}/api/projects/{pid}", token=token)  # soft-delete
    if vid:
        _req("DELETE", f"{base}/api/videos/{vid}", token=token)    # removes S3 copy
    print(f"  cleaned up project={pid} class={cid} video={vid}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.getenv("E2E_BASE", "https://windsurf-api.tclab.org"))
    ap.add_argument("--email", default=os.getenv("E2E_EMAIL", "e2e-test@tclab.org"))
    ap.add_argument("--password", default=os.getenv("E2E_PASSWORD"))
    ap.add_argument("--timeout", type=int, default=int(os.getenv("E2E_TIMEOUT", "300")))
    args = ap.parse_args()
    if not args.password:
        print("E2E_PASSWORD (or --password) is required", file=sys.stderr)
        return 2
    if not FIXTURE.exists():
        print(f"fixture missing: {FIXTURE}", file=sys.stderr)
        return 2

    print(f"e2e tracking journey → {args.base}")
    ctx = {}
    t0 = time.time()
    try:
        ctx = run(args.base, args.email, args.password, args.timeout)
        print(f"✅ PASS in {time.time()-t0:.0f}s")
        return 0
    except AssertionError as e:
        print(f"❌ FAIL: {e}")
        return 1
    except Exception as e:
        print(f"❌ ERROR: {type(e).__name__}: {e}")
        return 1
    finally:
        print("▶ teardown")
        try:
            teardown(args.base, args.email, args.password, ctx)
        except Exception as e:
            print(f"⚠ teardown error: {e}")


if __name__ == "__main__":
    sys.exit(main())
