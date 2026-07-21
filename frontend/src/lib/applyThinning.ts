/**
 * Pure, non-destructive track thinning. A Track carries an ordered list of ThinOps; this module
 * derives which of the track's annotations survive. Ops apply IN SEQUENCE — each narrows the current
 * survivor set — so stacking ops is progressively more aggressive and order matters. No React/DOM;
 * mirrors lib/samMapping.ts / lib/annotationOps.ts (never mutates inputs).
 *
 * `excluded` is derived here and nowhere else, so thinning is fully reversible: change/remove ops and
 * recompute from scratch (idempotent).
 */
import { Annotation, ThinOp, Track } from "@/types/annotation";

const area = (a: Annotation): number => (a.bbox ? a.bbox.w * a.bbox.h : 0);

function applyOp(survivors: Annotation[], op: ThinOp): Annotation[] {
  switch (op.kind) {
    case "everyN": {
      const n = Math.max(1, Math.floor(op.n));
      return survivors.filter((_, i) => i % n === 0);
    }
    case "minScore": {
      // missing score -> kept (no-op when the endpoint didn't provide scores)
      return survivors.filter((a) => a.score === undefined || a.score >= op.v);
    }
    case "minScaleDeltaPct": {
      const out: Annotation[] = [];
      let lastArea = -1;
      for (const a of survivors) {
        const ar = area(a);
        if (lastArea < 0) {
          out.push(a); // always keep the first survivor
          lastArea = ar;
        } else if (lastArea <= 0) {
          out.push(a); // can't judge a zero-area reference -> keep
          lastArea = ar;
        } else {
          const deltaPct = (Math.abs(ar - lastArea) / lastArea) * 100;
          if (deltaPct >= op.pct) {
            out.push(a);
            lastArea = ar;
          }
        }
      }
      return out;
    }
    case "maxPerTrack": {
      const k = Math.floor(op.k);
      if (k <= 0) return [];
      if (survivors.length <= k) return survivors;
      if (k === 1) return [survivors[0]];
      // evenly spaced including both endpoints; dedupe rounding collisions
      const idx = new Set<number>();
      for (let i = 0; i < k; i++) idx.add(Math.round((i * (survivors.length - 1)) / (k - 1)));
      return survivors.filter((_, i) => idx.has(i));
    }
    default:
      return survivors;
  }
}

/** The set of annotation ids KEPT after applying `ops` (in order) to a track's annotations. */
export function keptIds(trackAnnotations: Annotation[], ops: ThinOp[]): Set<string> {
  let survivors = [...trackAnnotations].sort((a, b) => a.frameCreated - b.frameCreated);
  for (const op of ops) survivors = applyOp(survivors, op);
  return new Set(survivors.map((a) => a.id));
}

/**
 * Return a new annotations array with `excluded` recomputed for the given track's annotations
 * (others untouched). Idempotent — recompute any time the track's ops change.
 */
export function recomputeExclusions(annotations: Annotation[], track: Track): Annotation[] {
  const trackAnns = annotations.filter((a) => a.trackId === track.id);
  const kept = keptIds(trackAnns, track.thinning);
  return annotations.map((a) =>
    a.trackId === track.id ? { ...a, excluded: !kept.has(a.id) } : a,
  );
}
