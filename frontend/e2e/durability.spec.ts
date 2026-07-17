import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
  return (await page.evaluate(() => localStorage.getItem("auth_token")))!;
}

test("an explicitly-created project's annotations persist to the backend", async ({ page, request }) => {
  test.setTimeout(90_000);
  const token = await uiLogin(page);
  const h = { Authorization: `Bearer ${token}` };

  const up = await request.post(`${API}/api/videos/upload`, {
    headers: h,
    multipart: { file: { name: "moving_square.mp4", mimeType: "video/mp4", buffer: readFileSync(FIXTURE) } },
  });
  const videoId: string = (await up.json()).video_id;

  try {
    // Seed a project the way handleProjectCreate does: a LOCAL uuid id and NO
    // backendProjectId — i.e. NOT yet on the backend. Durability requires the
    // auto-save to back it.
    await page.evaluate(({ videoId }) => {
      const now = Date.now();
      const meta = { duration: 2, fps: 10, width: 320, height: 240, totalFrames: 20, fileSize: 2380 };
      localStorage.setItem("managedVideos", JSON.stringify([
        { id: videoId, filename: "moving_square.mp4", status: "ready", metadata: meta, isActive: false, createdAt: now, lastAccessedAt: now },
      ]));
      localStorage.setItem("projects", JSON.stringify([{
        id: crypto.randomUUID(), name: "durability-check", videoIds: [videoId], createdAt: now, lastModified: now,
        classes: [{ id: "class-1", name: "square", color: "#e11", colorName: "red" }],
        instances: [{ id: "inst-1", classId: "class-1", instanceNumber: 1, metadata: {} }],
        annotations: [{ id: "ann-0", instanceId: "inst-1", frameCreated: 0, points: [], bbox: { x: 10, y: 10, w: 15, h: 20 }, isKeyframe: true }],
        keyframes: [], scenes: [], videoMetadata: {},
      }]));
      localStorage.setItem("activeProjectId", JSON.parse(localStorage.getItem("projects")!)[0].id);
    }, { videoId });

    await page.reload();
    // let the mount-restore + the 2s debounced auto-save run (creates the backend project)
    await page.waitForTimeout(7000);

    // The backend now has a project for this video with the seeded annotation state.
    await expect
      .poll(async () => {
        const list = await request.get(`${API}/api/projects`, { headers: h });
        const projects = (await list.json()).projects || [];
        const backed = projects.find((p: any) => p.video_id === videoId);
        return backed?.settings?.annotations?.length ?? 0;
      }, { timeout: 20_000 })
      .toBeGreaterThan(0);
  } finally {
    const list = await request.get(`${API}/api/projects`, { headers: h });
    for (const p of ((await list.json()).projects || [])) {
      if (p.name === "durability-check") await request.delete(`${API}/api/projects/${p.id}`, { headers: h });
    }
    await request.delete(`${API}/api/videos/${videoId}`, { headers: h });
  }
});
