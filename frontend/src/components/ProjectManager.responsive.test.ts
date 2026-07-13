import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Guards the mobile-responsiveness fix for the Video Manager dialog.
 *
 * At a 390px viewport the dialog previously rendered ~1024px wide and caused
 * horizontal page overflow because of a hardcoded 5xl dialog + a fixed 420px
 * sidebar. These string assertions lock in the responsive class shape so a
 * future edit can't silently reintroduce the fixed-width layout.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "ProjectManager.tsx"), "utf8");

describe("ProjectManager responsive layout", () => {
  it("no longer hardcodes the sidebar width without a responsive breakpoint", () => {
    // A bare (non-md) `w-[420px]` token (preceded by whitespace/quote, i.e. not
    // `md:w-[420px]` or `md:max-w-[420px]`) would overflow a 390px phone.
    expect(source).not.toMatch(/[\s"'`]w-\[420px\]/);
    expect(source).not.toMatch(/[\s"'`]min-w-\[420px\]/);
    expect(source).not.toMatch(/[\s"'`]max-w-\[420px\]/);
  });

  it("applies the 420px sidebar only at the md breakpoint and up", () => {
    expect(source).toContain("md:w-[420px]");
    expect(source).toContain("md:min-w-[420px]");
    // Full width below md so it never exceeds the viewport.
    expect(source).toMatch(/w-full md:w-\[420px\]/);
  });

  it("constrains the dialog to the viewport (w-[95vw]) instead of a fixed 5xl", () => {
    expect(source).toContain("w-[95vw]");
  });

  it("stacks the two panes below md and only goes side-by-side at md+", () => {
    expect(source).toContain("flex flex-col md:flex-row");
  });
});
