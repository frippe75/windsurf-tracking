"""
SAM2 Celery tasks for distributed video tracking and segmentation
"""

import os
import sys

# Add windsurf library to path
sys.path.insert(0, '/app')

from ..celery import app
from windsurf.sail_tracking import track_objects_in_video
from windsurf.ai_models import segment_frame_with_prompts


# ---------------------------------------------------------------------------
# Video access: the worker has no shared filesystem with the API, so it pulls
# the source video from the same S3 bucket the backend uses (creds via env,
# see kubernetes/gpu-workers.yaml). Cached under /tmp by object key.
# ---------------------------------------------------------------------------
def _fetch_video_from_s3(bucket: str, key: str) -> str:
    import boto3

    safe = key.replace('/', '_')
    local_path = os.path.join('/tmp', safe)
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        return local_path

    endpoint = os.getenv('S3_ENDPOINT')
    client = boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=os.getenv('S3_ACCESS_KEY'),
        aws_secret_access_key=os.getenv('S3_SECRET_KEY'),
    )
    tmp = local_path + '.part'
    client.download_file(bucket, key, tmp)
    os.replace(tmp, local_path)
    return local_path


def _mask_to_base64(mask) -> str:
    """Encode a single HxW mask (bool/float/uint8) as a base64 PNG (L mode)."""
    import base64
    from io import BytesIO
    import numpy as np
    from PIL import Image

    arr = np.asarray(mask)
    if arr.dtype != np.uint8:
        arr = (arr > 0).astype(np.uint8) * 255
    img = Image.fromarray(arr, mode='L')
    buf = BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('utf-8')


@app.task(bind=True, name='workers.tasks.sam2.track_objects_task')
def track_objects_task(self, job_data):
    """
    Celery task for SAM2 video tracking.

    Args:
        job_data: Dict with
            - video_path OR (s3_bucket + s3_key): source video location
            - objects_data: [{object_id, positive_points:[(x,y)], negative_points:[...]}]
            - start_frame, end_frame: absolute frame indices into the video
            - model_size: SAM2 size (default 'tiny')

    Returns:
        Dict with per-frame tracking results (bboxes + base64 masks) and metadata.
    """

    worker_id = os.getenv('WORKER_ID', '0')
    print(f"🚀 SAM2 Worker {worker_id}: Starting tracking task {self.request.id}")

    try:
        # Resolve the source video: explicit local path, else pull from S3.
        video_path = job_data.get('video_path')
        if not video_path or not os.path.exists(video_path):
            bucket = job_data.get('s3_bucket') or os.getenv('S3_BUCKET', 'windsurf-videos')
            key = job_data.get('s3_key')
            if not key:
                raise ValueError("job_data needs a readable video_path or an s3_key")
            print(f"   ⬇️  Fetching video from s3://{bucket}/{key}")
            video_path = _fetch_video_from_s3(bucket, key)

        objects_data = job_data['objects_data']
        start_frame = int(job_data['start_frame'])
        end_frame = int(job_data['end_frame'])
        model_size = job_data.get('model_size', 'tiny')

        print(f"   📹 Video: {os.path.basename(video_path)}")
        print(f"   🎯 Objects: {len(objects_data)}")
        print(f"   📊 Frames: {start_frame}-{end_frame} ({end_frame - start_frame} frames)")

        total = max(1, end_frame - start_frame)
        self.update_state(state='PROGRESS', meta={
            'current_frame': start_frame, 'total_frames': total,
            'percentage': 0.0, 'stage': 'initializing',
        })

        def progress_callback(current_frame, percentage, phase):
            self.update_state(state='PROGRESS', meta={
                'current_frame': start_frame + int(current_frame),
                'total_frames': total,
                'percentage': float(percentage),
                'stage': phase,
                'frames_completed': int((float(percentage) / 100.0) * total),
            })

        # Real SAM2 video propagation.
        results, frame_masks, _scaled = track_objects_in_video(
            video_path=video_path,
            objects_data=objects_data,
            initial_frame=start_frame,
            end_frame=end_frame,
            model_size=model_size,
            progress_callback=progress_callback,
        )

        # Flatten to a JSON-serializable per-frame array the frontend parses
        # (frame + object_ids[] + bboxes[] + masks_base64[]).
        frame_results = results.get('frame_results', {}) if isinstance(results, dict) else {}
        tracking_results = []
        for frame_idx in range(start_frame, end_frame):
            fd = frame_results.get(frame_idx, {})
            masks_b64 = []
            masks_for_frame = frame_masks.get(frame_idx) if isinstance(frame_masks, dict) else None
            if masks_for_frame:
                for m in masks_for_frame:
                    if m is not None:
                        try:
                            masks_b64.append(_mask_to_base64(m))
                        except Exception as enc_err:
                            print(f"   ⚠️ mask encode failed frame {frame_idx}: {enc_err}")
                            masks_b64.append("")
            tracking_results.append({
                'frame': frame_idx,
                'bboxes': fd.get('bboxes', []),
                'centers': fd.get('centers', []),
                'object_ids': fd.get('object_ids', []),
                'masks_base64': masks_b64,
                'success': len(fd.get('bboxes', [])) > 0,
            })

        tracked = sum(1 for r in tracking_results if r['success'])
        print(f"✅ SAM2 Worker {worker_id}: tracked {tracked}/{len(tracking_results)} frames")

        return {
            'success': True,
            'results': {
                'frames': tracking_results,
                'total_frames': len(tracking_results),
                'summary': {'frames_tracked': tracked, 'success': True},
            },
            'frame_count': len(tracking_results),
            'objects_tracked': len(objects_data),
            'worker_id': worker_id,
            'model_used': results.get('model', f"sam2-{model_size}") if isinstance(results, dict) else f"sam2-{model_size}",
            'gpu_id': os.getenv('CUDA_VISIBLE_DEVICES', 'unknown'),
        }

    except Exception as e:
        import traceback
        print(f"❌ SAM2 Worker {worker_id}: Tracking task failed - {e}")
        traceback.print_exc()
        # Return a failure payload rather than update_state(state='FAILURE'):
        # a custom FAILURE meta isn't a real exception, so Celery's result
        # backend can't decode it and every worker that later reads it crashes
        # (poisons the queue). The API treats success=False as failed.
        return {'success': False, 'error': str(e), 'worker_id': worker_id}


@app.task(bind=True, name='workers.tasks.sam2.segment_frame_task')
def segment_frame_task(self, segmentation_data):
    """
    Celery task for SAM2 single frame segmentation

    Args:
        segmentation_data: Dict with frame image and click prompts

    Returns:
        Dict with segmentation mask and bbox
    """

    worker_id = os.getenv('WORKER_ID', '0')
    print(f"🔍 SAM2 Worker {worker_id}: Starting segmentation task {self.request.id}")

    try:
        from PIL import Image
        import base64
        from io import BytesIO

        # Extract parameters
        if 'frame_base64' in segmentation_data:
            # Decode base64 image
            image_data = base64.b64decode(segmentation_data['frame_base64'])
            pil_frame = Image.open(BytesIO(image_data))
        else:
            pil_frame = segmentation_data['pil_frame']

        positive_prompts = segmentation_data['positive_prompts']
        negative_prompts = segmentation_data.get('negative_prompts', [])

        print(f"   🎯 Prompts: {len(positive_prompts)} positive, {len(negative_prompts)} negative")

        # Execute segmentation
        result = segment_frame_with_prompts(pil_frame, positive_prompts, negative_prompts)

        if result['success']:
            print(f"✅ SAM2 Worker {worker_id}: Segmentation completed - {result.get('score', 'unknown')} confidence")

            # Convert numpy arrays to serializable format
            if 'mask' in result and result['mask'] is not None:
                import numpy as np
                # Convert boolean mask to base64 encoded PNG
                mask_uint8 = (result['mask'] * 255).astype(np.uint8)
                mask_image = Image.fromarray(mask_uint8, mode='L')

                buffer = BytesIO()
                mask_image.save(buffer, format='PNG')
                result['mask_base64'] = base64.b64encode(buffer.getvalue()).decode('utf-8')

                # Remove the numpy array to avoid serialization issues
                del result['mask']
        else:
            print(f"❌ SAM2 Worker {worker_id}: Segmentation failed - {result.get('error', 'unknown')}")

        return {
            'success': result['success'],
            'result': result,
            'worker_id': worker_id,
            'gpu_id': os.getenv('CUDA_VISIBLE_DEVICES', 'unknown')
        }

    except Exception as e:
        print(f"❌ SAM2 Worker {worker_id}: Segmentation task failed - {e}")
        # Return a failure payload rather than update_state(state='FAILURE') —
        # a custom FAILURE meta can't be decoded by the result backend and
        # poisons the queue (crashes workers that read it).
        return {
            'success': False,
            'error': str(e),
            'worker_id': worker_id
        }
