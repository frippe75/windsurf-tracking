import { describe, it, expect } from "vitest";
import { migrateStoredProjects } from "./projectMigration";

describe("migrateStoredProjects", () => {
  it("returns [] for null (no stored projects)", () => {
    expect(migrateStoredProjects(null)).toEqual([]);
  });

  it("returns [] for malformed JSON instead of throwing", () => {
    expect(migrateStoredProjects("{not json")).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    expect(migrateStoredProjects('{"a":1}')).toEqual([]);
  });

  it("migrates legacy single videoId to videoIds array", () => {
    const legacy = JSON.stringify([{ id: "p1", name: "Old", videoId: "v1" }]);
    const [p] = migrateStoredProjects(legacy);
    expect(p.videoIds).toEqual(["v1"]);
    expect((p as any).videoId).toBeUndefined();
  });

  it("initializes missing videoIds to empty array", () => {
    const [p] = migrateStoredProjects(JSON.stringify([{ id: "p1", name: "NoVideos" }]));
    expect(p.videoIds).toEqual([]);
  });

  it("passes through current-format projects untouched (annotations already scoped)", () => {
    const current = [{ id: "p1", name: "New", videoIds: ["v1", "v2"], annotations: [{ id: "a1", videoId: "v1" }] }];
    expect(migrateStoredProjects(JSON.stringify(current))).toEqual(current);
  });

  it("does not clobber videoIds when both old and new fields exist", () => {
    const [p] = migrateStoredProjects(JSON.stringify([{ id: "p1", videoId: "old", videoIds: ["new"] }]));
    expect(p.videoIds).toEqual(["new"]);
  });

  it("backfills legacy annotations (no videoId) to the project's original/first video", () => {
    // A multi-video project whose annotations predate scoping: they belong to the founding clip v1.
    const stored = JSON.stringify([
      { id: "p1", videoIds: ["v1", "v2"], annotations: [{ id: "a1" }, { id: "a2" }] },
    ]);
    const [p] = migrateStoredProjects(stored);
    expect(p.annotations.map((a: any) => a.videoId)).toEqual(["v1", "v1"]);
  });

  it("does not overwrite annotations that already carry a videoId", () => {
    const stored = JSON.stringify([
      { id: "p1", videoIds: ["v1", "v2"], annotations: [{ id: "a1", videoId: "v2" }, { id: "a2" }] },
    ]);
    const [p] = migrateStoredProjects(stored);
    // a1 keeps its own clip, a2 (legacy) inherits the founding clip
    expect(p.annotations.map((a: any) => a.videoId)).toEqual(["v2", "v1"]);
  });

  it("also backfills after the legacy videoId→videoIds migration", () => {
    const [p] = migrateStoredProjects(
      JSON.stringify([{ id: "p1", videoId: "vOnly", annotations: [{ id: "a1" }] }]),
    );
    expect(p.videoIds).toEqual(["vOnly"]);
    expect(p.annotations[0].videoId).toBe("vOnly");
  });

  it("leaves annotations alone when the project has no videos", () => {
    const [p] = migrateStoredProjects(JSON.stringify([{ id: "p1", annotations: [{ id: "a1" }] }]));
    expect(p.annotations[0].videoId).toBeUndefined();
  });
});
