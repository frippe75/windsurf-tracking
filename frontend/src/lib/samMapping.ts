/**
 * Pure mappings from pipeline_service SAM3 responses to the editor's Instance/Annotation model.
 *
 * Extracted VERBATIM from pages/Index.tsx (handleAddSamDetections + handleSamTrack ingest) so the
 * risky conversion logic is unit-testable in isolation. No React, no DOM, no fetch. Behavior is
 * preserved exactly — including the quirks (see docs/REFACTOR_DEBT.md):
 *   - detect bbox comes in as NATIVE pixels -> nativeBBoxToPct; track bbox comes in as bbox_pct
 *     (already percent) -> {x,y,w,h} directly.
 *   - points = polygon when it has >=3 points, else the bbox rectangle (bboxToPolygon).
 *   - detect annotations are keyframes (isKeyframe:true); track annotations are not (false).
 *   - instanceNumber is seeded from the CURRENT instance count for the class (a stale snapshot at
 *     call time — matches the old inline behavior; numbering can collide across a detect-all loop).
 */
import { Annotation, Instance } from "@/types/annotation";
import { nativeBBoxToPct, bboxToPolygon } from "@/lib/coordinates";

type Point = { x: number; y: number };

export type SamDetection = { bbox: number[]; score?: number; polygon?: Point[] };
export type TrackObject = { object_id?: number; bbox_pct?: number[]; polygon?: Point[]; score?: number };
export type TrackFrame = { frame_number: number; objects?: TrackObject[] };

export interface DetectCtx {
  classId: string;
  existingInstances: Instance[];
  currentFrame: number;
  nativeWidth: number;
  nativeHeight: number;
  now?: () => number; // injectable for deterministic ids in tests (defaults to Date.now)
}

export interface TrackCtx {
  classId: string;
  existingInstances: Instance[];
  trackId?: string; // tags produced annotations so track-thinning can target them
  now?: () => number;
}

/** SAM3 concept detections (native-px bbox + optional percent polygon) -> instances + keyframe annotations. */
export function detectionsToAnnotations(
  dets: SamDetection[],
  ctx: DetectCtx,
): { instances: Instance[]; annotations: Annotation[] } {
  const now = ctx.now ?? Date.now;
  const valid = dets.filter((d) => Array.isArray(d.bbox) && d.bbox.length === 4);
  const instances: Instance[] = [];
  const annotations: Annotation[] = [];
  let n = ctx.existingInstances.filter((inst) => inst.classId === ctx.classId).length;
  valid.forEach((d, i) => {
    const bbox = nativeBBoxToPct(d.bbox as [number, number, number, number], ctx.nativeWidth, ctx.nativeHeight);
    const inst: Instance = {
      id: `inst-${now()}-${ctx.classId}-${i}`,
      classId: ctx.classId,
      instanceNumber: ++n,
      metadata: {},
    };
    instances.push(inst);
    const poly = d.polygon && d.polygon.length >= 3 ? d.polygon : bboxToPolygon(bbox);
    annotations.push({
      id: `ann-${now()}-${ctx.classId}-${i}`,
      instanceId: inst.id,
      points: poly,
      bbox,
      frameCreated: ctx.currentFrame,
      isKeyframe: true,
    });
  });
  return { instances, annotations };
}

/** SAM3 video-track frames (per-object bbox_pct + optional polygon) -> one instance per object_id + per-frame annotations. */
export function trackFramesToAnnotations(
  frames: TrackFrame[],
  ctx: TrackCtx,
): { instances: Instance[]; annotations: Annotation[] } {
  const now = ctx.now ?? Date.now;
  const instByObj = new Map<number, string>();
  const instances: Instance[] = [];
  const annotations: Annotation[] = [];
  let n = ctx.existingInstances.filter((inst) => inst.classId === ctx.classId).length;
  for (const fr of frames || []) {
    for (const o of fr.objects || []) {
      const oid = o.object_id ?? 0;
      let instId = instByObj.get(oid);
      if (!instId) {
        instId = `inst-${now()}-${oid}`;
        instByObj.set(oid, instId);
        instances.push({ id: instId, classId: ctx.classId, instanceNumber: ++n, metadata: {} });
      }
      const p = o.bbox_pct;
      if (!p || p.length !== 4) continue;
      const bbox = { x: p[0], y: p[1], w: p[2] - p[0], h: p[3] - p[1] };
      const poly = o.polygon && o.polygon.length >= 3 ? o.polygon : bboxToPolygon(bbox);
      annotations.push({
        id: `ann-${now()}-${oid}-${fr.frame_number}`,
        instanceId: instId,
        points: poly,
        bbox,
        frameCreated: fr.frame_number,
        isKeyframe: false,
        trackId: ctx.trackId,
        score: o.score,
      });
    }
  }
  return { instances, annotations };
}
