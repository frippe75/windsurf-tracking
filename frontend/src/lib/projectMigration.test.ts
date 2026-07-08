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

  it("passes through current-format projects untouched", () => {
    const current = [{ id: "p1", name: "New", videoIds: ["v1", "v2"], annotations: [{ id: "a1" }] }];
    expect(migrateStoredProjects(JSON.stringify(current))).toEqual(current);
  });

  it("does not clobber videoIds when both old and new fields exist", () => {
    const [p] = migrateStoredProjects(JSON.stringify([{ id: "p1", videoId: "old", videoIds: ["new"] }]));
    expect(p.videoIds).toEqual(["new"]);
  });
});
