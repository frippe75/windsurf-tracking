import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Multi-video scoping journey: a project with TWO clips that share one annotation array.
 * We seed clip #1 with boxes (videoId-stamped) and clip #2 with none, then switch the active
 * clip through the REAL Project-Manager UI and assert the canvas only ever paints the loaded
 * clip's boxes — clip #1's boxes must NOT bleed onto clip #2, and must reappear on switching back.
 *
 * The rendered truth is VideoPlayer's per-redraw log `📍 Frame N: X visible annotations` — X is
 * the count of boxes actually drawn on the current frame (VideoPlayer receives the video-scoped
 * list). Driving canvas *drawing* is timing-flaky, so annotation state is seeded; the SWITCH and
 * the scoping run entirely through the app's real hydrate → video-select → canvas path.
 */
const EMAIL = process.env.E2E_EMAIL || "e2e-test@tclab.org";
const PASSWORD = process.env.E2E_PASSWORD;
const API = process.env.E2E_API_BASE || "https://windsurf-api.tclab.org";
const FIXTURE = resolve(__dirname, "../../backend/tests/e2e/fixtures/moving_square.mp4");

test.skip(!PASSWORD, "set E2E_PASSWORD to run browser e2e");

async function uiLogin(page: Page): Promise<string> {
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  expect(token, "logged-in token").toBeTruthy();
  return token!;
}

async function uploadVideo(req: APIRequestContext, token: string, name: string): Promise<string> {
  const up = await req.post(`${API}/api/videos/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name, mimeType: "video/mp4", buffer: readFileSync(FIXTURE) } },
  });
  expect(up.ok(), `upload ${name}: ${up.status()}`).toBeTruthy();
  return (await up.json()).video_id;
}

test("annotations stay with their clip when switching videos in a project", async ({ page, request }) => {
  test.setTimeout(150_000);
  const token = await uiLogin(page);
  const h = { Authorization: `Bearer ${token}` };

  const NAME1 = "square-one.mp4";
  const NAME2 = "square-two.mp4";
  const v1 = await uploadVideo(request, token, NAME1);
  const v2 = await uploadVideo(request, token, NAME2);
  const PROJECT_NAME = `e2e-multivideo-${Date.now()}`;

  // Collect VideoPlayer's per-redraw visibility logs → the boxes actually painted.
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  const visLogs = () =>
    logs
      .map((t) => t.match(/📍 Frame (\d+): (\d+) visible annotations/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ frame: Number(m[1]), count: Number(m[2]) }));

  try {
    // Seed a project holding BOTH clips; clip #1 carries the boxes (videoId-stamped to v1),
    // clip #2 has none. currentVideoIdInProject = v1 so the app opens on clip #1.
    await page.evaluate(({ v1, v2, name, NAME1, NAME2 }) => {
      const now = Date.now();
      const meta = { duration: 2, fps: 10, width: 320, height: 240, totalFrames: 20, fileSize: 2380 };
      localStorage.setItem("managedVideos", JSON.stringify([
        { id: v1, filename: NAME1, status: "ready", metadata: meta, isActive: false, createdAt: now, lastAccessedAt: now },
        { id: v2, filename: NAME2, status: "ready", metadata: meta, isActive: false, createdAt: now, lastAccessedAt: now },
      ]));
      const annotations = [0, 5, 10].map((i) => ({
        id: `ann-${i}`, instanceId: "inst-1", videoId: v1, frameCreated: i, points: [],
        bbox: { x: (30 + i * 11) / 320 * 100, y: (30 + i * 8) / 240 * 100, w: 48 / 320 * 100, h: 48 / 240 * 100 },
        isKeyframe: i === 0,
      }));
      localStorage.setItem("projects", JSON.stringify([{
        id: "proj-mv", name, videoIds: [v1, v2], createdAt: now, lastModified: now,
        classes: [{ id: "class-1", name: "square", color: "#e11", colorName: "red" }],
        instances: [{ id: "inst-1", classId: "class-1", instanceNumber: 1, metadata: {} }],
        annotations, keyframes: [], scenes: [], videoMetadata: {},
      }]));
      localStorage.setItem("activeProjectId", "proj-mv");
      localStorage.setItem("currentVideoIdInProject", v1);
    }, { v1, v2, name: PROJECT_NAME, NAME1, NAME2 });

    // Hydrate: app opens on clip #1 at frame 0 → the seeded box is painted.
    await page.reload();
    await expect
      .poll(() => visLogs().some((v) => v.frame === 0 && v.count >= 1), { timeout: 25_000 })
      .toBe(true);

    // Switch to clip #2 through the real Project-Manager video list.
    const beforeSwitch = logs.length;
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("button", { name: `Select ${NAME2}` }).click();

    // Clip #2 renders (we get fresh visibility logs) …
    await expect
      .poll(() => logs.slice(beforeSwitch).some((t) => /visible annotations/.test(t)), { timeout: 25_000 })
      .toBe(true);
    // … and NONE of them paint a box — clip #1's annotations never bleed onto clip #2.
    const afterSwitch = logs
      .slice(beforeSwitch)
      .map((t) => t.match(/📍 Frame \d+: (\d+) visible annotations/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => Number(m[1]));
    expect(afterSwitch.length, "clip #2 produced visibility logs").toBeGreaterThan(0);
    expect(afterSwitch.every((c) => c === 0), `clip #2 must show 0 boxes, saw ${afterSwitch.join(",")}`).toBe(true);

    // Switch back to clip #1 → its boxes reappear (scoping is dynamic, not a one-way clear).
    const beforeBack = logs.length;
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("button", { name: `Select ${NAME1}` }).click();
    await expect
      .poll(() => logs.slice(beforeBack).some((t) => {
        const m = t.match(/📍 Frame 0: (\d+) visible annotations/);
        return !!m && Number(m[1]) >= 1;
      }), { timeout: 25_000 })
      .toBe(true);
  } finally {
    try {
      const list = await request.get(`${API}/api/projects`, { headers: h });
      for (const p of ((await list.json()).projects || [])) {
        if ((p.name || "").startsWith("e2e-multivideo")) await request.delete(`${API}/api/projects/${p.id}`, { headers: h });
      }
      await request.delete(`${API}/api/videos/${v1}`, { headers: h });
      await request.delete(`${API}/api/videos/${v2}`, { headers: h });
    } catch {
      /* best-effort cleanup */
    }
  }
});
