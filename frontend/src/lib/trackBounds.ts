/**
 * Keep a SAM3 track inside one scene/clip: a track propagated across a scene cut produces garbage
 * (the tracker follows into unrelated footage). So clamp the requested end frame to the end of the
 * scene that contains the start frame. If scenes haven't been detected (or the start isn't inside
 * any scene), the requested end is used unchanged.
 */
import { Scene } from "@/types/annotation";

export function sceneAt(frame: number, scenes: Scene[]): Scene | undefined {
  return scenes.find((s) => frame >= s.startFrame && frame <= s.endFrame);
}

/** Clamp `requestedEnd` so the [start, end] range never crosses a scene boundary. */
export function clampEndToScene(startFrame: number, requestedEnd: number, scenes: Scene[]): number {
  const scene = sceneAt(startFrame, scenes);
  if (!scene) return requestedEnd; // no scene info -> don't constrain
  return Math.min(requestedEnd, scene.endFrame);
}
