import { describe, it, expect } from "vitest";
import {
  SAIL_COLORS,
  annotationsForVideo,
  createClass,
  leastUsedColorIndex,
  renameClassById,
  deleteClassCascade,
  renameInstanceById,
  removeInstanceById,
  removeAnnotationsForInstance,
  updateInstanceMetadata,
  nextInstanceNumber,
  updateAnnotationById,
  annotationsAtFrame,
  removePromptFromAnnotation,
  toggleKeyframe,
  deleteKeyframesAtFrame,
  setSceneQuality,
} from "./annotationOps";
import { Class, Instance, Annotation, Keyframe, Scene } from "@/types/annotation";

function makeClass(id: string): Class {
  return { id, name: `Class ${id}`, color: "red", colorName: "Red" };
}

function makeInstance(id: string, classId: string): Instance {
  return { id, classId, instanceNumber: 1, metadata: {} };
}

function makeAnnotation(id: string, instanceId: string, frame = 0): Annotation {
  return { id, instanceId, frameCreated: frame, points: [], isKeyframe: true };
}

function makeKeyframe(frame: number, type: Keyframe["type"]): Keyframe {
  return { frame, type, timestamp: "t" };
}

describe("createClass", () => {
  it("cycles through the palette by colorIndex", () => {
    const c0 = createClass("A", 0, () => 1);
    const c1 = createClass("B", 1, () => 2);
    const cWrapped = createClass("C", SAIL_COLORS.length, () => 3);

    expect(c0.color).toBe(SAIL_COLORS[0].hex);
    expect(c0.colorName).toBe(SAIL_COLORS[0].name);
    expect(c1.color).toBe(SAIL_COLORS[1].hex);
    expect(cWrapped.color).toBe(SAIL_COLORS[0].hex);
    expect(c0.id).toBe("class-1");
    expect(c0.name).toBe("A");
  });
});

describe("class ops", () => {
  it("renameClassById renames only the target", () => {
    const classes = [makeClass("c1"), makeClass("c2")];
    const renamed = renameClassById(classes, "c1", "Sail");
    expect(renamed[0].name).toBe("Sail");
    expect(renamed[1].name).toBe("Class c2");
    expect(classes[0].name).toBe("Class c1"); // input untouched
  });

  it("deleteClassCascade removes the class, its instances, and their annotations", () => {
    const classes = [makeClass("c1"), makeClass("c2")];
    const instances = [makeInstance("i1", "c1"), makeInstance("i2", "c2")];
    const annotations = [makeAnnotation("a1", "i1"), makeAnnotation("a2", "i2")];

    const result = deleteClassCascade(classes, instances, annotations, "c1");

    expect(result.classes.map((c) => c.id)).toEqual(["c2"]);
    expect(result.instances.map((i) => i.id)).toEqual(["i2"]);
    expect(result.annotations.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("instance ops", () => {
  it("renameInstanceById sets the optional name", () => {
    const instances = [makeInstance("i1", "c1")];
    expect(renameInstanceById(instances, "i1", "Lead sail")[0].name).toBe("Lead sail");
  });

  it("removeInstanceById + removeAnnotationsForInstance cascade", () => {
    const instances = [makeInstance("i1", "c1"), makeInstance("i2", "c1")];
    const annotations = [makeAnnotation("a1", "i1"), makeAnnotation("a2", "i2")];

    expect(removeInstanceById(instances, "i1").map((i) => i.id)).toEqual(["i2"]);
    expect(removeAnnotationsForInstance(annotations, "i1").map((a) => a.id)).toEqual(["a2"]);
  });

  it("updateInstanceMetadata replaces metadata on the target instance", () => {
    const instances = [makeInstance("i1", "c1")];
    const updated = updateInstanceMetadata(instances, "i1", { brand: "North Sails" });
    expect(updated[0].metadata).toEqual({ brand: "North Sails" });
  });

  it("nextInstanceNumber counts instances per class (1-based)", () => {
    const instances = [makeInstance("i1", "c1"), makeInstance("i2", "c1"), makeInstance("i3", "c2")];
    expect(nextInstanceNumber(instances, "c1")).toBe(3);
    expect(nextInstanceNumber(instances, "c3")).toBe(1);
  });
});

describe("annotation ops", () => {
  it("updateAnnotationById merges partial updates", () => {
    const annotations = [makeAnnotation("a1", "i1"), makeAnnotation("a2", "i1")];
    const updated = updateAnnotationById(annotations, "a1", {
      bbox: { x: 1, y: 2, w: 3, h: 4 },
    });
    expect(updated[0].bbox).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(updated[0].instanceId).toBe("i1");
    expect(updated[1].bbox).toBeUndefined();
  });

  it("annotationsAtFrame filters by frameCreated", () => {
    const annotations = [
      makeAnnotation("a1", "i1", 5),
      makeAnnotation("a2", "i1", 6),
      makeAnnotation("a3", "i1", 5),
    ];
    expect(annotationsAtFrame(annotations, 5).map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("removePromptFromAnnotation removes by index and empties to undefined", () => {
    const annotations: Annotation[] = [
      {
        ...makeAnnotation("a1", "i1"),
        sam2Prompts: [
          { x: 1, y: 1, type: "positive" },
          { x: 2, y: 2, type: "negative" },
        ],
      },
    ];

    const once = removePromptFromAnnotation(annotations, "a1", 0);
    expect(once[0].sam2Prompts).toEqual([{ x: 2, y: 2, type: "negative" }]);

    const twice = removePromptFromAnnotation(once, "a1", 0);
    expect(twice[0].sam2Prompts).toBeUndefined();
  });
});

describe("keyframe ops", () => {
  it("toggleKeyframe adds when absent and removes when present (same frame+type)", () => {
    const added = toggleKeyframe([], 10, "START", "ts");
    expect(added.added).toBe(true);
    expect(added.keyframes).toEqual([{ frame: 10, type: "START", timestamp: "ts" }]);

    const removed = toggleKeyframe(added.keyframes, 10, "START", "ts2");
    expect(removed.added).toBe(false);
    expect(removed.keyframes).toEqual([]);
  });

  it("toggleKeyframe keeps other types at the same frame", () => {
    const keyframes = [makeKeyframe(10, "START"), makeKeyframe(10, "STOP")];
    const result = toggleKeyframe(keyframes, 10, "START", "ts");
    expect(result.keyframes).toEqual([makeKeyframe(10, "STOP")]);
  });

  it("deleteKeyframesAtFrame removes all types at that frame", () => {
    const keyframes = [makeKeyframe(10, "START"), makeKeyframe(10, "META"), makeKeyframe(20, "STOP")];
    expect(deleteKeyframesAtFrame(keyframes, 10)).toEqual([makeKeyframe(20, "STOP")]);
  });
});

describe("scene ops", () => {
  it("setSceneQuality updates only the target scene", () => {
    const scenes: Scene[] = [
      { id: "s1", startFrame: 0, endFrame: 10, quality: "unknown" },
      { id: "s2", startFrame: 10, endFrame: 20, quality: "unknown" },
    ];
    const updated = setSceneQuality(scenes, "s1", "good");
    expect(updated[0].quality).toBe("good");
    expect(updated[1].quality).toBe("unknown");
  });
});

describe("leastUsedColorIndex", () => {
  const mk = (color: string) => ({ id: `c-${Math.random()}`, name: "x", color, colorName: "" });

  it("returns 0 for no classes", () => {
    expect(leastUsedColorIndex([])).toBe(0);
  });

  it("picks the first unused palette color", () => {
    const classes = [mk(SAIL_COLORS[0].hex), mk(SAIL_COLORS[1].hex)];
    expect(leastUsedColorIndex(classes)).toBe(2); // 0,1 used -> 2 is first free
  });

  it("spreads: two creates in a row get distinct colors", () => {
    const first = createClass("A", leastUsedColorIndex([]));
    const second = createClass("B", leastUsedColorIndex([first]));
    expect(first.color).not.toBe(second.color);
  });
})

describe("annotationsForVideo", () => {
  const mk = (id: string, videoId?: string) =>
    ({ id, instanceId: "i", frameCreated: 0, points: [], isKeyframe: true, videoId } as any);

  it("keeps only annotations for the given clip", () => {
    const anns = [mk("a", "vA"), mk("b", "vB"), mk("c", "vA")];
    expect(annotationsForVideo(anns, "vA").map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("does NOT bleed another clip's boxes onto this clip (the regression)", () => {
    const anns = [mk("a", "vA"), mk("b", "vB")];
    expect(annotationsForVideo(anns, "vB").map((a) => a.id)).toEqual(["b"]);
  });

  it("treats legacy annotations (no videoId) as belonging to the current clip", () => {
    const anns = [mk("legacy", undefined), mk("scoped", "vA")];
    expect(annotationsForVideo(anns, "vA").map((a) => a.id)).toEqual(["legacy", "scoped"]);
    expect(annotationsForVideo(anns, "vZ").map((a) => a.id)).toEqual(["legacy"]);
  });

  it("does not mutate the input", () => {
    const anns = [mk("a", "vA")];
    annotationsForVideo(anns, "vB");
    expect(anns).toHaveLength(1);
  });
})
