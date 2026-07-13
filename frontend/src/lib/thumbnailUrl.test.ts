import { describe, it, expect } from "vitest";
import {
  thumbnailUrl,
  backendFrameThumbnailUrl,
  isBackendThumbnail,
} from "./thumbnailUrl";
import type { ManagedVideo } from "@/types/video";

type ThumbVideo = Pick<ManagedVideo, "id" | "youtubeUrl" | "youtubeThumbnail">;

const BACKEND = "http://backend.test";

describe("backendFrameThumbnailUrl", () => {
  it("builds the frame/0 URL with default 160x112 dimensions", () => {
    expect(backendFrameThumbnailUrl("vid1", BACKEND)).toBe(
      "http://backend.test/api/videos/vid1/frame/0?width=160&height=112",
    );
  });

  it("honours explicit dimensions", () => {
    expect(backendFrameThumbnailUrl("vid1", BACKEND, 320, 200)).toBe(
      "http://backend.test/api/videos/vid1/frame/0?width=320&height=200",
    );
  });
});

describe("thumbnailUrl", () => {
  it("prefers a cached YouTube thumbnail (no backend load)", () => {
    const video: ThumbVideo = {
      id: "vid1",
      youtubeThumbnail: "https://img.youtube.com/vi/CACHED/hqdefault.jpg",
      youtubeUrl: "https://youtube.com/watch?v=abcdefghijk",
    };
    expect(thumbnailUrl(video, BACKEND)).toBe(
      "https://img.youtube.com/vi/CACHED/hqdefault.jpg",
    );
  });

  it("derives the YouTube thumbnail from the URL when no cached one exists", () => {
    const video: ThumbVideo = {
      id: "vid1",
      youtubeUrl: "https://youtube.com/watch?v=abcdefghijk",
    };
    expect(thumbnailUrl(video, BACKEND)).toBe(
      "https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg",
    );
  });

  it("falls back to the backend frame for uploaded (non-YouTube) videos", () => {
    const video: ThumbVideo = { id: "vid1" };
    expect(thumbnailUrl(video, BACKEND)).toBe(
      "http://backend.test/api/videos/vid1/frame/0?width=160&height=112",
    );
  });

  it("falls back to the backend frame when the YouTube URL has no id", () => {
    const video: ThumbVideo = { id: "vid1", youtubeUrl: "not-a-youtube-url" };
    expect(thumbnailUrl(video, BACKEND)).toBe(
      "http://backend.test/api/videos/vid1/frame/0?width=160&height=112",
    );
  });
});

describe("isBackendThumbnail", () => {
  it("is true only for videos that resolve to a backend frame", () => {
    expect(isBackendThumbnail({ id: "v" })).toBe(true);
    expect(isBackendThumbnail({ id: "v", youtubeUrl: "garbage" })).toBe(true);
    expect(
      isBackendThumbnail({ id: "v", youtubeUrl: "https://youtu.be/abcdefghijk" }),
    ).toBe(false);
    expect(
      isBackendThumbnail({ id: "v", youtubeThumbnail: "https://x/y.jpg" }),
    ).toBe(false);
  });
});
