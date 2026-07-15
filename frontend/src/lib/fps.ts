/**
 * Derive the real frames-per-second from the backend's known frame count and
 * the video element's actual duration.
 *
 * A hardcoded fps (e.g. 30) mis-seeks every video whose real rate differs:
 * scrubbing to frame N shows the frame at N/30s while the backend extracts
 * frame N at N/realFps — so a SAM2 mask can come back for a DIFFERENT frame
 * than the one on screen. Returns `fallback` until a reliable value is known.
 */
export function deriveFps(
  totalFrames: number | undefined,
  duration: number | undefined,
  fallback = 30,
): number {
  if (
    totalFrames &&
    duration &&
    totalFrames > 0 &&
    duration > 0 &&
    Number.isFinite(totalFrames) &&
    Number.isFinite(duration)
  ) {
    return totalFrames / duration;
  }
  return fallback;
}
