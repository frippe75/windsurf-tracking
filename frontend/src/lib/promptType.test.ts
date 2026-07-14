import { describe, it, expect } from "vitest";
import { resolvePromptType } from "./promptType";

describe("resolvePromptType", () => {
  it("Ctrl → positive", () => {
    expect(resolvePromptType(true, false, null)).toBe("positive");
  });
  it("Alt → negative", () => {
    expect(resolvePromptType(false, true, null)).toBe("negative");
  });
  it("Alt-Gr (ctrl+alt) → negative", () => {
    expect(resolvePromptType(true, true, null)).toBe("negative");
  });
  it("no modifier + no tap mode → null (desktop must hold a key)", () => {
    expect(resolvePromptType(false, false, null)).toBeNull();
  });
  it("no modifier falls back to the tap mode (mobile)", () => {
    expect(resolvePromptType(false, false, "positive")).toBe("positive");
    expect(resolvePromptType(false, false, "negative")).toBe("negative");
  });
  it("modifiers override the tap mode", () => {
    expect(resolvePromptType(true, false, "negative")).toBe("positive");
    expect(resolvePromptType(false, true, "positive")).toBe("negative");
  });
});
