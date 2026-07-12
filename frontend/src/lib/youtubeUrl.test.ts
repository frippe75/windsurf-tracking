import { describe, it, expect } from "vitest";
import { extractYoutubeId, isValidYoutubeUrl, youtubeThumbnail } from "./youtubeUrl";

describe("extractYoutubeId", () => {
  it("youtu.be short link", () => {
    expect(extractYoutubeId("https://youtu.be/iWhThc1gLRM")).toBe("iWhThc1gLRM");
  });

  it("youtu.be with ?is= param (the URL that was reported broken)", () => {
    expect(extractYoutubeId("https://youtu.be/iWhThc1gLRM?is=DaqPgfyKIPyTPvBF")).toBe("iWhThc1gLRM");
  });

  it("youtu.be with ?si= share param", () => {
    expect(extractYoutubeId("https://youtu.be/9rdqHolIfkE?si=TRfxQJFY3K77OOYU")).toBe("9rdqHolIfkE");
  });

  it("watch?v= long link", () => {
    expect(extractYoutubeId("https://www.youtube.com/watch?v=iWhThc1gLRM")).toBe("iWhThc1gLRM");
  });

  it("watch?v= with extra params", () => {
    expect(extractYoutubeId("https://www.youtube.com/watch?v=iWhThc1gLRM&t=42s")).toBe("iWhThc1gLRM");
  });

  it("embed link", () => {
    expect(extractYoutubeId("https://www.youtube.com/embed/iWhThc1gLRM")).toBe("iWhThc1gLRM");
  });

  it("no www / no scheme", () => {
    expect(extractYoutubeId("youtu.be/iWhThc1gLRM")).toBe("iWhThc1gLRM");
  });

  it("returns null for non-YouTube URL", () => {
    expect(extractYoutubeId("https://vimeo.com/12345")).toBeNull();
    expect(extractYoutubeId("not a url")).toBeNull();
    expect(extractYoutubeId("")).toBeNull();
  });
});

describe("isValidYoutubeUrl", () => {
  it("accepts the reported-broken URL", () => {
    expect(isValidYoutubeUrl("https://youtu.be/iWhThc1gLRM?is=DaqPgfyKIPyTPvBF")).toBe(true);
  });
  it("trims surrounding whitespace", () => {
    expect(isValidYoutubeUrl("  https://youtu.be/iWhThc1gLRM  ")).toBe(true);
  });
  it("rejects junk", () => {
    expect(isValidYoutubeUrl("hello")).toBe(false);
  });
});

describe("youtubeThumbnail", () => {
  it("builds the hqdefault URL from the id", () => {
    expect(youtubeThumbnail("https://youtu.be/iWhThc1gLRM?is=x")).toBe(
      "https://img.youtube.com/vi/iWhThc1gLRM/hqdefault.jpg"
    );
  });
  it("undefined when no id", () => {
    expect(youtubeThumbnail("https://vimeo.com/1")).toBeUndefined();
  });
});
