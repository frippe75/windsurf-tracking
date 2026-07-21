/**
 * Derived per-annotation frame attributes — computed FREE from the bbox geometry (no LLM). These
 * are the frame-level axes that actually matter for a detection dataset (object scale, truncation),
 * and they're cheaper + more reliable to derive than to ask a model. Fed into the balance view so
 * "am I covering small objects, or is it all close-ups?" is answerable at a glance.
 */
import { Annotation } from "@/types/annotation";

type BBox = { x: number; y: number; w: number; h: number }; // percent-of-frame (0–100)

/** Object scale bucket from bbox area as a fraction of the frame (COCO-ish small/med/large). */
export function scaleBucket(bbox: BBox): "small" | "medium" | "large" {
  const areaFrac = (bbox.w / 100) * (bbox.h / 100);
  if (areaFrac < 0.01) return "small"; // < 1% of frame
  if (areaFrac < 0.1) return "medium"; // 1–10%
  return "large";
}

/** True if the bbox touches a frame edge (object clipped / partially out of frame). */
export function isTruncated(bbox: BBox, eps = 0.5): boolean {
  return bbox.x <= eps || bbox.y <= eps || bbox.x + bbox.w >= 100 - eps || bbox.y + bbox.h >= 100 - eps;
}

export type DerivedCounts = {
  scale: Record<string, number>;
  truncation: Record<string, number>;
  total: number;
};

/** Count derived attributes over the annotations that would actually export (has bbox, not thinned). */
export function countDerived(annotations: Annotation[]): DerivedCounts {
  const scale: Record<string, number> = { small: 0, medium: 0, large: 0 };
  const truncation: Record<string, number> = { full: 0, truncated: 0 };
  let total = 0;
  for (const a of annotations) {
    if (a.excluded || !a.bbox || a.bbox.w <= 0 || a.bbox.h <= 0) continue;
    total++;
    scale[scaleBucket(a.bbox)]++;
    truncation[isTruncated(a.bbox) ? "truncated" : "full"]++;
  }
  return { scale, truncation, total };
}
