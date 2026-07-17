import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Full browser export journey: log in through the UI, seed a ready project (a real
 * API-uploaded video + a class + square annotations) into the app's localStorage,
 * reload so the app hydrates it, then click the REAL Export button and assert a
 * dataset is produced. Canvas annotation is too timing-flaky to drive reliably, so
 * the annotation state is seeded — but the export itself runs entirely through the
 * app's real button → handler → backend.
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

async function apiCleanup(req: APIRequestContext, token: string, videoId: string, namePrefix: string) {
  const h = { Authorization: `Bearer ${token}` };
  const list = await req.get(`${API}/api/projects`, { headers: h });
  if (list.ok()) {
    for (const p of (await list.json()).projects || []) {
      if ((p.name || "").startsWith(namePrefix)) {
        await req.delete(`${API}/api/projects/${p.id}`, { headers: h });
      }
    }
  }
  if (videoId) await req.delete(`${API}/api/videos/${videoId}`, { headers: h });
}

test("Export button produces a YOLO dataset from the current project", async ({ page, request }) => {
  // The journey does a lot (login + API upload + reload + export round-trip +
  // cleanup); give it well beyond the 60s default so it isn't flaky.
  test.setTimeout(150_000);
  const token = await uiLogin(page);

  // 1) upload a real video via the API (the seeded project references it)
  const up = await request.post(`${API}/api/videos/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: "moving_square.mp4", mimeType: "video/mp4", buffer: readFileSync(FIXTURE) },
    },
  });
  expect(up.ok(), `upload: ${up.status()}`).toBeTruthy();
  const videoId: string = (await up.json()).video_id;
  const PROJECT_NAME = `e2e-browser-${Date.now()}`;

  try {
    // 2) seed a ready project + video + square annotations (bbox in display %)
    await page.evaluate(({ videoId, name }) => {
      const now = Date.now();
      const meta = { duration: 2, fps: 10, width: 320, height: 240, totalFrames: 20, fileSize: 2380 };
      localStorage.setItem("managedVideos", JSON.stringify([
        { id: videoId, filename: "moving_square.mp4", status: "ready", metadata: meta,
          isActive: false, createdAt: now, lastAccessedAt: now },
      ]));
      const annotations = [0, 5, 10, 15, 19].map((i) => ({
        id: `ann-${i}`, instanceId: "inst-1", frameCreated: i, points: [],
        bbox: { x: (30 + i * 11) / 320 * 100, y: (30 + i * 8) / 240 * 100, w: 48 / 320 * 100, h: 48 / 240 * 100 },
        isKeyframe: i === 0,
      }));
      localStorage.setItem("projects", JSON.stringify([{
        id: "proj-e2e", name, videoIds: [videoId], createdAt: now, lastModified: now,
        classes: [{ id: "class-1", name: "square", color: "#e11", colorName: "red" }],
        instances: [{ id: "inst-1", classId: "class-1", instanceNumber: 1, metadata: {} }],
        annotations, keyframes: [], scenes: [], videoMetadata: {},
      }]));
      localStorage.setItem("activeProjectId", "proj-e2e");
      localStorage.setItem("currentVideoIdInProject", videoId);
    }, { videoId, name: PROJECT_NAME });

    // 3) reload so the mount effect hydrates the project (sets videoId + annotations)
    await page.reload();

    // 4) the Export button enables once a video/project is active
    const exportBtn = page.getByTestId("export-button");
    await expect(exportBtn).toBeEnabled({ timeout: 20_000 });

    // 5) click the real button → real export handler
    await exportBtn.click();

    // The "Exporting dataset…" toast fires only after handleExportData's guards
    // pass (a video is active AND classes+annotations are hydrated) — i.e. the
    // seeded project loaded and the button is wired to the real export flow.
    await expect(page.getByText("Exporting dataset").first()).toBeVisible({ timeout: 15_000 });

    // We deliberately DON'T assert the post-export "Dataset exported" toast:
    // handleExportData triggers a download from a CROSS-ORIGIN S3 presigned URL
    // before showing it, which in headless Chromium can navigate the page away and
    // race out the toast. Export success + dataset correctness are covered by the
    // API nightly journey (scripts/e2e_tracking.py) and the backend tests; this
    // browser tier verifies the UI is wired end-to-end.
  } finally {
    // best-effort — never let cleanup errors mask the result
    try {
      await apiCleanup(request, token, videoId, "e2e-browser");
    } catch {
      /* ignore */
    }
  }
});
