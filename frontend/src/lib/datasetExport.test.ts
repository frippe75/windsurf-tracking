import { describe, it, expect, vi } from "vitest";
import { bboxFromPoints, pctBbox, buildAnnotationPayload, exportProjectAsYolo, type ExportApi } from "./datasetExport";
import type { Annotation, Class, Instance } from "@/types/annotation";

const cls = (id: string, name: string): Class => ({ id, name, color: "#e11", colorName: "red" });
const inst = (id: string, classId: string): Instance => ({ id, classId, instanceNumber: 1, metadata: {} });
const ann = (id: string, instanceId: string, frame: number, bbox?: Annotation["bbox"], points: Annotation["points"] = []): Annotation => ({
  id, instanceId, frameCreated: frame, points, bbox, isKeyframe: frame === 0,
});

describe("bbox helpers", () => {
  it("bboxFromPoints returns the axis-aligned bounds", () => {
    expect(bboxFromPoints([{ x: 10, y: 20 }, { x: 40, y: 30 }, { x: 25, y: 60 }]))
      .toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(bboxFromPoints([])).toBeNull();
  });

  it("pctBbox prefers the explicit bbox, else derives from points", () => {
    expect(pctBbox(ann("a", "i", 0, { x: 5, y: 5, w: 10, h: 10 }))).toEqual({ x: 5, y: 5, w: 10, h: 10 });
    expect(pctBbox(ann("a", "i", 0, undefined, [{ x: 0, y: 0 }, { x: 20, y: 10 }]))).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
});

describe("buildAnnotationPayload", () => {
  const instances = [inst("i1", "c1")];
  const classMap = { c1: "backend-c1" };
  const instMap = { i1: "uuid-i1" };

  it("maps ids and converts percent bbox to normalized [0,1]", () => {
    const out = buildAnnotationPayload([ann("a1", "i1", 3, { x: 50, y: 25, w: 10, h: 20 })], instances, classMap, instMap);
    expect(out).toEqual([{
      instance_id: "uuid-i1", class_id: "backend-c1", frame_number: 3, annotation_type: "bbox",
      geometry: { bbox: { x: 0.5, y: 0.25, w: 0.1, h: 0.2 } }, is_keyframe: false,
    }]);
  });

  it("drops annotations with no mapped class, no instance, or no box", () => {
    const anns = [
      ann("a1", "i1", 0, { x: 0, y: 0, w: 0, h: 0 }),        // zero-size box
      ann("a2", "missing", 1, { x: 1, y: 1, w: 5, h: 5 }),   // unknown instance
      ann("a3", "i1", 2, undefined, []),                     // no box at all
    ];
    expect(buildAnnotationPayload(anns, instances, classMap, instMap)).toEqual([]);
  });

  it("skips a class that wasn't mapped to a backend id", () => {
    const out = buildAnnotationPayload([ann("a1", "i1", 0, { x: 1, y: 1, w: 5, h: 5 })], instances, {}, instMap);
    expect(out).toEqual([]);
  });
});

describe("exportProjectAsYolo orchestration", () => {
  function makeApi(): ExportApi {
    return {
      createBackendProject: vi.fn().mockResolvedValue({ id: "proj-1" }),
      createBackendClass: vi.fn().mockImplementation((_pid, name) => Promise.resolve({ id: `backend-${name}` })),
      saveBackendAnnotations: vi.fn().mockResolvedValue({ saved: 1 }),
      exportDataset: vi.fn().mockResolvedValue({ project_id: "proj-1", sink: "zip", stats: {}, result: { kind: "zip", url: "http://z/ds.zip" } }),
    };
  }

  it("creates project + classes, saves mapped annotations, and exports", async () => {
    const api = makeApi();
    let n = 0;
    const res = await exportProjectAsYolo({
      projectName: "p", videoId: "v1",
      classes: [cls("c1", "sail")],
      instances: [inst("i1", "c1")],
      annotations: [ann("a1", "i1", 0, { x: 10, y: 10, w: 20, h: 20 })],
      api, genId: () => `uuid-${++n}`, now: () => "T",
    });

    expect(api.createBackendProject).toHaveBeenCalledWith("p T", "v1");
    expect(api.createBackendClass).toHaveBeenCalledWith("proj-1", "sail", "#e11");
    // annotation saved with backend class id + generated instance uuid + normalized box
    const saved = (api.saveBackendAnnotations as any).mock.calls[0][1];
    expect(saved).toEqual([{
      instance_id: "uuid-1", class_id: "backend-sail", frame_number: 0, annotation_type: "bbox",
      geometry: { bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, is_keyframe: true,
    }]);
    expect(api.exportDataset).toHaveBeenCalledWith("proj-1", "zip");
    expect(res.result.url).toBe("http://z/ds.zip");
  });

  it("throws before exporting when there are no usable boxes", async () => {
    const api = makeApi();
    await expect(exportProjectAsYolo({
      projectName: "p", videoId: "v1",
      classes: [cls("c1", "sail")], instances: [inst("i1", "c1")],
      annotations: [ann("a1", "i1", 0, undefined, [])],  // no box
      api, genId: () => "x", now: () => "T",
    })).rejects.toThrow(/no bounding boxes/i);
    expect(api.saveBackendAnnotations).not.toHaveBeenCalled();
    expect(api.exportDataset).not.toHaveBeenCalled();
  });
});
