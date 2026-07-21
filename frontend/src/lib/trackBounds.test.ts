import { describe, it, expect } from "vitest";
import { clampEndToScene, sceneAt } from "./trackBounds";
import { Scene } from "@/types/annotation";

const scene = (id: string, startFrame: number, endFrame: number): Scene => ({ id, startFrame, endFrame, quality: "unknown" });
const scenes = [scene("s1", 0, 99), scene("s2", 100, 199)];

describe("clampEndToScene", () => {
  it("clamps the end to the scene the start is in", () => {
    // start 80, want +50 -> 130, but scene s1 ends at 99
    expect(clampEndToScene(80, 130, scenes)).toBe(99);
  });

  it("leaves the end alone when it's already inside the scene", () => {
    expect(clampEndToScene(10, 50, scenes)).toBe(50);
  });

  it("uses the requested end when there are no scenes", () => {
    expect(clampEndToScene(10, 200, [])).toBe(200);
  });

  it("uses the requested end when the start isn't inside any scene", () => {
    expect(clampEndToScene(500, 600, scenes)).toBe(600);
  });

  it("respects the correct scene for a start in the second clip", () => {
    expect(clampEndToScene(150, 300, scenes)).toBe(199);
  });

  it("collapses to a single frame at a scene's last frame", () => {
    expect(clampEndToScene(99, 149, scenes)).toBe(99);
  });
});

describe("sceneAt", () => {
  it("finds the containing scene (inclusive bounds)", () => {
    expect(sceneAt(0, scenes)?.id).toBe("s1");
    expect(sceneAt(99, scenes)?.id).toBe("s1");
    expect(sceneAt(100, scenes)?.id).toBe("s2");
    expect(sceneAt(250, scenes)).toBeUndefined();
  });
});
