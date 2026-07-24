import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DatasetVersionSummary } from "@/lib/api";

// Mock the api module so loadProjectModels can be tested without network.
vi.mock("@/lib/api", () => ({ getVideoDatasetVersions: vi.fn() }));
import { getVideoDatasetVersions } from "@/lib/api";
import { loadProjectModels } from "./TrainedDetectorPanel";

const mk = (version_id: string, maps: number[]): DatasetVersionSummary =>
  ({
    version_id,
    models: maps.map((m, i) => ({ run_id: `${version_id}-r${i}`, model: "yolov8n", epochs: 10, metrics: { mAP50: m } })),
  } as any);

const mocked = getVideoDatasetVersions as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("loadProjectModels", () => {
  it("merges trained models across all the project's clips (available regardless of loaded clip)", async () => {
    mocked.mockImplementation(async (id: string) =>
      id === "vA" ? [mk("d1", [0.5]), mk("d0", [])] : [mk("d2", [0.9])],
    );
    const out = await loadProjectModels(["vA", "vB"]);
    // d0 has no models → dropped; d1 + d2 kept, best-mAP first.
    expect(out.map((v) => v.version_id)).toEqual(["d2", "d1"]);
  });

  it("dedups a version that appears under more than one clip", async () => {
    mocked.mockImplementation(async (id: string) =>
      id === "vA" ? [mk("d1", [0.5])] : [mk("d1", [0.5]), mk("d2", [0.9])],
    );
    const out = await loadProjectModels(["vA", "vB"]);
    expect(out.map((v) => v.version_id)).toEqual(["d2", "d1"]);
  });

  it("tolerates a clip whose fetch fails (does not drop the others)", async () => {
    mocked.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("boom");
      return [mk("d1", [0.7])];
    });
    const out = await loadProjectModels(["vA", "bad"]);
    expect(out.map((v) => v.version_id)).toEqual(["d1"]);
  });

  it("returns empty when no clip has a trained model", async () => {
    mocked.mockResolvedValue([mk("d0", [])]);
    expect(await loadProjectModels(["vA"])).toEqual([]);
  });
});
