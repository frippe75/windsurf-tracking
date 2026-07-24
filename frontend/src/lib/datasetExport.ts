/**
 * On-demand YOLO export: push the current project's classes + annotations to the
 * backend, then trigger dataset generation.
 *
 * Frontend ids aren't UUIDs and annotation bboxes are display percentages (0–100),
 * so this module maps ids and converts coordinates. The backend's coordinate
 * contract is normalized [0,1] top-left+size (displayed-% / 100 = native fraction,
 * since the displayed rect is object-contain / same aspect as native).
 *
 * The transforms are pure + tested; the orchestration takes an injectable api.
 */
import type { Annotation, Class, Instance } from "@/types/annotation";
import type {
  BackendAnnotation,
  ExportResult,
  createBackendProject as CreateProject,
  createBackendClass as CreateClass,
  saveBackendAnnotations as SaveAnns,
  exportDataset as ExportDataset,
} from "@/lib/api";

type Pct = { x: number; y: number; w: number; h: number };

/** Axis-aligned percentage bbox around polygon points (all in 0–100). */
export function bboxFromPoints(points: Array<{ x: number; y: number }> | undefined): Pct | null {
  if (!points || points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The annotation's percentage bbox — its own bbox if present, else from points. */
export function pctBbox(a: Annotation): Pct | null {
  if (a.bbox && a.bbox.w > 0 && a.bbox.h > 0) return a.bbox;
  return bboxFromPoints(a.points);
}

/**
 * Convert frontend annotations to backend rows, resolving class via
 * instance→class and mapping frontend ids to backend/uuid ids. Annotations
 * without a usable box or a mapped class are dropped (detection needs a box).
 */
export function buildAnnotationPayload(
  annotations: Annotation[],
  instances: Instance[],
  classIdMap: Record<string, string>,
  instanceIdMap: Record<string, string>,
): BackendAnnotation[] {
  const instById = new Map(instances.map((i) => [i.id, i]));
  const out: BackendAnnotation[] = [];
  for (const a of annotations) {
    if (a.excluded) continue; // thinned out (non-destructive) -> omit from the dataset
    const inst = instById.get(a.instanceId);
    if (!inst) continue;
    const class_id = classIdMap[inst.classId];
    const instance_id = instanceIdMap[a.instanceId];
    if (!class_id || !instance_id) continue;
    const bb = pctBbox(a);
    if (!bb || bb.w <= 0 || bb.h <= 0) continue;
    out.push({
      instance_id,
      class_id,
      frame_number: a.frameCreated,
      annotation_type: "bbox",
      geometry: { bbox: { x: bb.x / 100, y: bb.y / 100, w: bb.w / 100, h: bb.h / 100 } },
      is_keyframe: a.isKeyframe,
      // carry the object's metadata (brand/color/…) into the exported dataset
      ...(inst.metadata && Object.keys(inst.metadata).length ? { tracking_metadata: inst.metadata } : {}),
    });
  }
  return out;
}

export interface ExportApi {
  createBackendProject: typeof CreateProject;
  createBackendClass: typeof CreateClass;
  saveBackendAnnotations: typeof SaveAnns;
  exportDataset: typeof ExportDataset;
}

export interface ExportProjectOpts {
  projectName: string;
  videoId: string;
  classes: Class[];
  instances: Instance[];
  annotations: Annotation[];
  api: ExportApi;
  sink?: string;
  genId?: () => string;
  now?: () => string;
  onProgress?: (done: number, total: number) => void; // per-image export progress
}

/** Create a backend project + classes, save annotations, and export a dataset. */
export async function exportProjectAsYolo(opts: ExportProjectOpts): Promise<ExportResult> {
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const stamp = (opts.now ?? (() => new Date().toISOString().slice(0, 19)))();

  const project = await opts.api.createBackendProject(`${opts.projectName} ${stamp}`, opts.videoId);

  const classIdMap: Record<string, string> = {};
  for (const c of opts.classes) {
    const created = await opts.api.createBackendClass(project.id, c.name, c.color);
    classIdMap[c.id] = created.id;
  }

  const instanceIdMap: Record<string, string> = {};
  for (const i of opts.instances) instanceIdMap[i.id] = genId();

  const payload = buildAnnotationPayload(opts.annotations, opts.instances, classIdMap, instanceIdMap);
  if (payload.length === 0) {
    throw new Error("No bounding boxes to export — annotations need a class and a box.");
  }
  await opts.api.saveBackendAnnotations(project.id, payload);

  return opts.api.exportDataset(project.id, opts.sink ?? "zip", {
    onProgress: (s) => {
      if (opts.onProgress && s.images_total) opts.onProgress(s.images_done ?? 0, s.images_total);
    },
  });
}
