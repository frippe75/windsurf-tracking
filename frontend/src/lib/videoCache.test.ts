import { describe, it, expect, beforeEach } from "vitest";
import { videoCache } from "./videoCache";

const entry = (videoId: string, filename: string) => ({
  videoId,
  filename,
  blob: new Blob([`data-${videoId}`], { type: "video/mp4" }),
  metadata: { duration: 1, fps: 30, width: 100, height: 100, totalFrames: 30, cachedAt: Date.now() },
});

describe("videoCache (IndexedDB via fake-indexeddb)", () => {
  beforeEach(async () => {
    await videoCache.init();
    await videoCache.clear();
  });

  it("set + get round-trips a video by filename", async () => {
    await videoCache.set("a.mp4", entry("v1", "a.mp4"));
    const got = await videoCache.get("a.mp4");
    expect(got?.videoId).toBe("v1");
    // fake-indexeddb's structured clone can't fully preserve jsdom Blobs;
    // assert presence + metadata round-trip (blob fidelity is a browser concern)
    expect(got!.blob).toBeDefined();
    expect(got!.metadata.totalFrames).toBe(30);
    expect(got!.filename).toBe("a.mp4");
  });

  it("get returns null for unknown filename", async () => {
    expect(await videoCache.get("nope.mp4")).toBeNull();
  });

  it("has reflects presence", async () => {
    expect(await videoCache.has("a.mp4")).toBe(false);
    await videoCache.set("a.mp4", entry("v1", "a.mp4"));
    expect(await videoCache.has("a.mp4")).toBe(true);
  });

  it("delete removes a single entry", async () => {
    await videoCache.set("a.mp4", entry("v1", "a.mp4"));
    await videoCache.set("b.mp4", entry("v2", "b.mp4"));
    await videoCache.delete("a.mp4");
    expect(await videoCache.has("a.mp4")).toBe(false);
    expect(await videoCache.has("b.mp4")).toBe(true);
  });

  it("set overwrites an existing filename (upsert)", async () => {
    await videoCache.set("a.mp4", entry("v1", "a.mp4"));
    await videoCache.set("a.mp4", entry("v9", "a.mp4"));
    const got = await videoCache.get("a.mp4");
    expect(got?.videoId).toBe("v9");
  });
});
