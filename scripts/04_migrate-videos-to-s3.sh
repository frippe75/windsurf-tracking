#!/bin/bash
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Windsurf: migrate baked-in videos to S3 (one-off Job)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

NS="windsurf-prod"

kubectl delete job windsurf-video-migration -n $NS 2>/dev/null || true

kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: Job
metadata:
  name: windsurf-video-migration
  namespace: windsurf-prod
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: migrate
        image: harbor.tclab.org/windsurf/annotation-api:v2-auth
        env:
        - name: S3_ENDPOINT
          value: "http://rook-ceph-rgw-ceph-objectstore.rook-ceph.svc.cluster.local"
        - name: S3_BUCKET
          value: "windsurf-videos"
        - name: S3_ACCESS_KEY
          valueFrom: {secretKeyRef: {name: windsurf-s3-secret, key: access-key}}
        - name: S3_SECRET_KEY
          valueFrom: {secretKeyRef: {name: windsurf-s3-secret, key: secret-key}}
        command: ["/bin/sh", "-c"]
        args:
        - |
          pip install --quiet --no-cache-dir boto3 && python - <<'PYEOF'
          import os, boto3, cv2
          from pathlib import Path
          from datetime import datetime, timezone

          s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"],
                            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                            aws_secret_access_key=os.environ["S3_SECRET_KEY"])
          bucket = os.environ["S3_BUCKET"]

          existing = set()
          for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="videos/"):
              existing.update(o["Key"] for o in page.get("Contents", []))

          uploads = sorted(Path("/app/uploads").glob("*.mp4"))
          done = skipped = failed = 0
          for f in uploads:
              key = f"videos/{f.stem}.mp4"
              if key in existing:
                  skipped += 1
                  continue
              cap = cv2.VideoCapture(str(f))
              if not cap.isOpened():
                  print(f"SKIP unreadable: {f.name}"); failed += 1; continue
              fps = cap.get(cv2.CAP_PROP_FPS) or 0
              frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
              w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
              cap.release()
              mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
              meta = {"filename": f.name, "duration": str(frames/fps if fps else 0),
                      "fps": str(fps), "width": str(w), "height": str(h),
                      "total_frames": str(frames), "upload_date": mtime.replace(tzinfo=None).isoformat()}
              s3.upload_file(str(f), bucket, key,
                             ExtraArgs={"Metadata": meta, "ContentType": "video/mp4"})
              done += 1
              print(f"OK {f.name} ({f.stat().st_size//1024//1024}MB {w}x{h} {frames}f)")

          print(f"DONE uploaded={done} skipped={skipped} failed={failed}")
          PYEOF
EOF

echo "Job created; waiting for completion..."
kubectl wait --for=condition=complete job/windsurf-video-migration -n $NS --timeout=1800s
kubectl logs job/windsurf-video-migration -n $NS | tail -8
