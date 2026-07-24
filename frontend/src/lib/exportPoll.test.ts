import { describe, it, expect, vi, afterEach } from "vitest";
import { exportDataset } from "./api";

type Resp = { ok?: boolean; status?: number; body?: any };

function mockFetch(responses: Resp[]) {
  const calls: string[] = [];
  let i = 0;
  global.fetch = vi.fn(async (url: any) => {
    calls.push(String(url));
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.ok ?? true, status: r.status ?? 200, statusText: "", text: async () => "", json: async () => r.body ?? {} } as any;
  });
  return calls;
}

const noSleep = () => Promise.resolve();

afterEach(() => vi.restoreAllMocks());

describe("exportDataset (dispatch + poll)", () => {
  it("dispatches, polls until completed, returns the result", async () => {
    const calls = mockFetch([
      { body: { job_id: "ex-1", status: "queued" } },              // POST dispatch
      { body: { job_id: "ex-1", status: "running", progress: 20 } }, // poll 1
      { body: { job_id: "ex-1", status: "completed", sink: "zip", stats: { images: 5 }, result: { kind: "zip", url: "https://s3/ds.zip" } } },
    ]);
    const res = await exportDataset("p1", "zip", { sleep: noSleep });
    expect(res.result.url).toBe("https://s3/ds.zip");
    expect(res.stats.images).toBe(5);
    expect(calls[0]).toContain("/api/projects/p1/export");
    expect(calls[2]).toContain("/export/status/ex-1");
  });

  it("throws on a failed job", async () => {
    mockFetch([
      { body: { job_id: "ex-2", status: "queued" } },
      { body: { job_id: "ex-2", status: "failed", error: "no annotations" } },
    ]);
    await expect(exportDataset("p1", "zip", { sleep: noSleep })).rejects.toThrow("no annotations");
  });
});
