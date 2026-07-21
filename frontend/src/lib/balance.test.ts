import { describe, it, expect } from "vitest";
import { countByField, countByClass } from "./balance";
import { Instance, Scene, Class, MetaField } from "@/types/annotation";

const inst = (id: string, classId: string, metadata: Record<string, string> = {}): Instance => ({ id, classId, instanceNumber: 1, metadata });
const scene = (id: string, metadata?: Record<string, string>): Scene => ({ id, startFrame: 0, endFrame: 1, quality: "unknown", metadata });
const cls = (id: string, name: string): Class => ({ id, name, color: "", colorName: "" });

describe("countByField", () => {
  const schema: MetaField[] = [
    { key: "sail_color", scope: "instance", type: "enum", values: ["red", "blue"] },
    { key: "weather", scope: "scene", type: "enum", values: ["sunny", "cloudy"] },
    { key: "location", scope: "video", type: "text" }, // ignored (video scope)
  ];

  it("counts instance + scene values, tracks unset, ignores video scope", () => {
    const instances = [inst("i1", "c1", { sail_color: "red" }), inst("i2", "c1", { sail_color: "red" }), inst("i3", "c1", {})];
    const scenes = [scene("s1", { weather: "sunny" }), scene("s2")];
    const out = countByField(instances, scenes, schema);
    expect(out).toHaveLength(2); // video-scope excluded
    const color = out.find((f) => f.key === "sail_color")!;
    expect(color.counts).toEqual({ red: 2 });
    expect(color.unset).toBe(1);
    expect(color.total).toBe(3);
    const weather = out.find((f) => f.key === "weather")!;
    expect(weather.counts).toEqual({ sunny: 1 });
    expect(weather.unset).toBe(1);
  });
});

describe("countByClass", () => {
  it("counts instances per class", () => {
    const classes = [cls("c1", "Sail"), cls("c2", "Board")];
    const instances = [inst("i1", "c1"), inst("i2", "c1"), inst("i3", "c2")];
    expect(countByClass(classes, instances)).toEqual([
      { classId: "c1", name: "Sail", count: 2 },
      { classId: "c2", name: "Board", count: 1 },
    ]);
  });
});
