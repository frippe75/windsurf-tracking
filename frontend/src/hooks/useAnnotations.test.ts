import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnnotations } from "./useAnnotations";
import { SAIL_COLORS } from "@/lib/annotationOps";
import { Annotation, Instance } from "@/types/annotation";

function makeInstance(id: string, classId: string): Instance {
  return { id, classId, instanceNumber: 1, metadata: {} };
}

function makeAnnotation(id: string, instanceId: string, frame = 0): Annotation {
  return { id, instanceId, frameCreated: frame, points: [], isKeyframe: true };
}

function setup(currentFrame = 0) {
  const toast = vi.fn();
  const view = renderHook(({ frame }) => useAnnotations({ currentFrame: frame, toast }), {
    initialProps: { frame: currentFrame },
  });
  return { ...view, toast };
}

describe("useAnnotations class management", () => {
  it("handleCreateClass adds, selects, and advances the palette", () => {
    const { result, toast } = setup();

    act(() => result.current.handleCreateClass("Sail"));
    act(() => result.current.handleCreateClass("Board"));

    expect(result.current.classes).toHaveLength(2);
    expect(result.current.classes[0].color).toBe(SAIL_COLORS[0].hex);
    expect(result.current.classes[1].color).toBe(SAIL_COLORS[1].hex);
    expect(result.current.selectedClassId).toBe(result.current.classes[1].id);
    expect(result.current.colorIndex).toBe(2);
    expect(toast).toHaveBeenCalledWith({ title: "Class created", description: "Sail" });
  });

  it("handleDeleteClass cascades to instances and annotations and clears selection", () => {
    const { result } = setup();

    act(() => result.current.handleCreateClass("Sail"));
    const classId = result.current.classes[0].id;
    act(() => {
      result.current.setInstances([makeInstance("i1", classId), makeInstance("i2", "other")]);
      result.current.setAnnotations([makeAnnotation("a1", "i1"), makeAnnotation("a2", "i2")]);
    });

    act(() => result.current.handleDeleteClass(classId));

    expect(result.current.classes).toHaveLength(0);
    expect(result.current.instances.map((i) => i.id)).toEqual(["i2"]);
    expect(result.current.annotations.map((a) => a.id)).toEqual(["a2"]);
    expect(result.current.selectedClassId).toBeUndefined();
  });

  it("handleRenameClass renames in place", () => {
    const { result } = setup();
    act(() => result.current.handleCreateClass("Sail"));
    const classId = result.current.classes[0].id;

    act(() => result.current.handleRenameClass(classId, "Mainsail"));

    expect(result.current.classes[0].name).toBe("Mainsail");
  });
});

describe("useAnnotations instance management", () => {
  it("handleDeleteInstance removes the instance and its annotations", () => {
    const { result, toast } = setup();
    act(() => {
      result.current.setInstances([makeInstance("i1", "c1")]);
      result.current.setAnnotations([makeAnnotation("a1", "i1"), makeAnnotation("a2", "i2")]);
    });

    act(() => result.current.handleDeleteInstance("i1"));

    expect(result.current.instances).toHaveLength(0);
    expect(result.current.annotations.map((a) => a.id)).toEqual(["a2"]);
    expect(toast).toHaveBeenCalledWith({ title: "Instance deleted" });
  });

  it("handleUpdateMetadata and handleRenameInstance update the target instance", () => {
    const { result } = setup();
    act(() => result.current.setInstances([makeInstance("i1", "c1")]));

    act(() => result.current.handleUpdateMetadata("i1", { brand: "North" }));
    act(() => result.current.handleRenameInstance("i1", "Lead"));

    expect(result.current.instances[0].metadata).toEqual({ brand: "North" });
    expect(result.current.instances[0].name).toBe("Lead");
  });
});

describe("useAnnotations annotations", () => {
  it("handleAnnotationUpdate merges partial updates", () => {
    const { result } = setup();
    act(() => result.current.setAnnotations([makeAnnotation("a1", "i1")]));

    act(() =>
      result.current.handleAnnotationUpdate("a1", { bbox: { x: 1, y: 2, w: 3, h: 4 } })
    );

    expect(result.current.annotations[0].bbox).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("handleDeletePrompt removes a SAM2 prompt and toasts", () => {
    const { result, toast } = setup();
    act(() =>
      result.current.setAnnotations([
        { ...makeAnnotation("a1", "i1"), sam2Prompts: [{ x: 1, y: 1, type: "positive" }] },
      ])
    );

    act(() => result.current.handleDeletePrompt("a1", 0));

    expect(result.current.annotations[0].sam2Prompts).toBeUndefined();
    expect(toast).toHaveBeenCalledWith({
      title: "Prompt deleted",
      description: "SAM2 point removed from annotation",
    });
  });
});

describe("useAnnotations keyframe toggling", () => {
  it("toggles a keyframe at the current frame on and off", () => {
    const { result, toast } = setup(42);

    act(() => result.current.handleAddKeyframe("START"));
    expect(result.current.keyframes).toHaveLength(1);
    expect(result.current.keyframes[0]).toMatchObject({ frame: 42, type: "START" });
    expect(toast).toHaveBeenLastCalledWith({
      title: "START keyframe added",
      description: "Frame 42",
    });

    act(() => result.current.handleAddKeyframe("START"));
    expect(result.current.keyframes).toHaveLength(0);
    expect(toast).toHaveBeenLastCalledWith({
      title: "START keyframe removed",
      description: "Frame 42",
    });
  });

  it("tracks the current frame prop", () => {
    const { result, rerender } = setup(10);

    act(() => result.current.handleAddKeyframe("START"));
    rerender({ frame: 20 });
    act(() => result.current.handleAddKeyframe("STOP"));

    expect(result.current.keyframes.map((k) => k.frame)).toEqual([10, 20]);
  });

  it("handleDeleteKeyframe removes all keyframe types at a frame", () => {
    const { result } = setup(10);
    act(() => result.current.handleAddKeyframe("START"));
    act(() => result.current.handleAddKeyframe("META"));

    act(() => result.current.handleDeleteKeyframe(10));

    expect(result.current.keyframes).toHaveLength(0);
  });
});

describe("useAnnotations scenes and metadata", () => {
  it("handleSceneQualityChange updates scene quality", () => {
    const { result } = setup();
    act(() =>
      result.current.setScenes([{ id: "s1", startFrame: 0, endFrame: 10, quality: "unknown" }])
    );

    act(() => result.current.handleSceneQualityChange("s1", "bad"));

    expect(result.current.scenes[0].quality).toBe("bad");
  });

  it("exposes videoMetadata state", () => {
    const { result } = setup();
    act(() => result.current.setVideoMetadata({ Location: "Maui" }));
    expect(result.current.videoMetadata).toEqual({ Location: "Maui" });
  });
});
