import { describe, it, expect } from "vitest";
import { detectionsToAnnotations, trackFramesToAnnotations } from "./samMapping";
import { Instance } from "@/types/annotation";

const now = () => 1; // deterministic ids
const inst = (id: string, classId: string): Instance => ({ id, classId, instanceNumber: 1, metadata: {} });

describe("detectionsToAnnotations", () => {
  const ctx = { classId: "cA", existingInstances: [] as Instance[], currentFrame: 7, nativeWidth: 1000, nativeHeight: 500, now };

  it("drops detections without a 4-number bbox", () => {
    const { instances, annotations } = detectionsToAnnotations(
      [{ bbox: [0, 0, 100, 100] }, { bbox: [1, 2, 3] }, { bbox: [] }],
      ctx,
    );
    expect(instances).toHaveLength(1);
    expect(annotations).toHaveLength(1);
  });

  it("empty input -> empty output", () => {
    expect(detectionsToAnnotations([], ctx)).toEqual({ instances: [], annotations: [] });
  });

  it("converts native-px bbox to percent and marks keyframe", () => {
    const { annotations } = detectionsToAnnotations([{ bbox: [100, 50, 300, 250] }], ctx);
    // [100,50,300,250] over 1000x500 -> x10 y10 w20 h40
    expect(annotations[0].bbox).toEqual({ x: 10, y: 10, w: 20, h: 40 });
    expect(annotations[0].isKeyframe).toBe(true);
    expect(annotations[0].frameCreated).toBe(7);
  });

  it("uses polygon (>=3 pts) as points, else the bbox rectangle", () => {
    const poly = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }];
    const withPoly = detectionsToAnnotations([{ bbox: [0, 0, 1000, 500], polygon: poly }], ctx);
    expect(withPoly.annotations[0].points).toEqual(poly);
    const twoPts = detectionsToAnnotations([{ bbox: [0, 0, 1000, 500], polygon: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }], ctx);
    // <3 -> bbox rectangle (4 corners of the 0..100% box)
    expect(twoPts.annotations[0].points).toHaveLength(4);
  });

  it("seeds instanceNumber from existing instances of the class and increments", () => {
    const existing = [inst("i1", "cA"), inst("i2", "cA"), inst("i3", "cB")];
    const { instances } = detectionsToAnnotations([{ bbox: [0, 0, 1, 1] }, { bbox: [0, 0, 1, 1] }], { ...ctx, existingInstances: existing });
    expect(instances.map((i) => i.instanceNumber)).toEqual([3, 4]); // 2 existing in cA -> 3,4
  });

  it("id schemes include class id and index", () => {
    const { instances, annotations } = detectionsToAnnotations([{ bbox: [0, 0, 1, 1] }], ctx);
    expect(instances[0].id).toBe("inst-1-cA-0");
    expect(annotations[0].id).toBe("ann-1-cA-0");
    expect(annotations[0].instanceId).toBe("inst-1-cA-0");
  });
});

describe("trackFramesToAnnotations", () => {
  const ctx = { classId: "cA", existingInstances: [] as Instance[], now };

  it("creates one instance per object_id across frames", () => {
    const frames = [
      { frame_number: 0, objects: [{ object_id: 0, bbox_pct: [10, 10, 30, 30] }, { object_id: 1, bbox_pct: [50, 50, 60, 60] }] },
      { frame_number: 1, objects: [{ object_id: 0, bbox_pct: [11, 11, 31, 31] }] },
    ];
    const { instances, annotations } = trackFramesToAnnotations(frames, ctx);
    expect(instances).toHaveLength(2); // obj 0 and 1, not re-created on frame 1
    expect(annotations).toHaveLength(3);
    expect(annotations.every((a) => a.isKeyframe === false)).toBe(true);
  });

  it("bbox_pct [x1,y1,x2,y2] -> {x,y,w,h} directly (not nativeBBoxToPct)", () => {
    const { annotations } = trackFramesToAnnotations(
      [{ frame_number: 5, objects: [{ object_id: 0, bbox_pct: [10, 20, 40, 60] }] }],
      ctx,
    );
    expect(annotations[0].bbox).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(annotations[0].frameCreated).toBe(5);
  });

  it("object_id missing defaults to 0", () => {
    const { instances } = trackFramesToAnnotations([{ frame_number: 0, objects: [{ bbox_pct: [0, 0, 1, 1] }] }], ctx);
    expect(instances[0].id).toBe("inst-1-0");
  });

  it("skips the annotation when bbox_pct is missing or not length 4 (instance still created)", () => {
    const { instances, annotations } = trackFramesToAnnotations(
      [{ frame_number: 0, objects: [{ object_id: 9, bbox_pct: [1, 2, 3] }] }],
      ctx,
    );
    expect(instances).toHaveLength(1); // instance created before the bbox check
    expect(annotations).toHaveLength(0);
  });

  it("uses polygon (>=3) else bbox rectangle; per-frame ann id scheme", () => {
    const poly = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    const { annotations } = trackFramesToAnnotations(
      [{ frame_number: 4, objects: [{ object_id: 2, bbox_pct: [0, 0, 10, 10], polygon: poly }] }],
      ctx,
    );
    expect(annotations[0].points).toEqual(poly);
    expect(annotations[0].id).toBe("ann-1-2-4");
  });

  it("seeds instanceNumber from existing instances of the class", () => {
    const existing = [inst("i1", "cA")];
    const { instances } = trackFramesToAnnotations(
      [{ frame_number: 0, objects: [{ object_id: 0, bbox_pct: [0, 0, 1, 1] }] }],
      { ...ctx, existingInstances: existing },
    );
    expect(instances[0].instanceNumber).toBe(2);
  });

  it("empty / no objects -> empty", () => {
    expect(trackFramesToAnnotations([], ctx)).toEqual({ instances: [], annotations: [] });
    expect(trackFramesToAnnotations([{ frame_number: 0 }], ctx)).toEqual({ instances: [], annotations: [] });
  });
});
