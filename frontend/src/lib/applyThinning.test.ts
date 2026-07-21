import { describe, it, expect } from "vitest";
import { keptIds, recomputeExclusions } from "./applyThinning";
import { Annotation, ThinOp, Track } from "@/types/annotation";

// annotation factory: id "aN" at frame N, with bbox area = size*size, optional score
const ann = (frame: number, size = 10, score?: number, trackId = "t1"): Annotation => ({
  id: `a${frame}`,
  instanceId: "i1",
  frameCreated: frame,
  points: [],
  bbox: { x: 0, y: 0, w: size, h: size },
  isKeyframe: false,
  trackId,
  score,
});

const range = (n: number) => Array.from({ length: n }, (_, i) => ann(i));
const ids = (s: Set<string>) => [...s].sort();

describe("keptIds — single ops", () => {
  it("empty ops keeps everything", () => {
    expect(keptIds(range(5), []).size).toBe(5);
  });

  it("everyN keeps every Nth by frame order", () => {
    const k = keptIds(range(10), [{ kind: "everyN", n: 3 }]);
    expect(ids(k)).toEqual(["a0", "a3", "a6", "a9"]);
  });

  it("everyN with n<=1 keeps all", () => {
    expect(keptIds(range(4), [{ kind: "everyN", n: 1 }]).size).toBe(4);
    expect(keptIds(range(4), [{ kind: "everyN", n: 0 }]).size).toBe(4);
  });

  it("minScore drops below threshold; missing score is kept", () => {
    const anns = [ann(0, 10, 0.9), ann(1, 10, 0.2), ann(2, 10, undefined)];
    expect(ids(keptIds(anns, [{ kind: "minScore", v: 0.5 }]))).toEqual(["a0", "a2"]);
  });

  it("minScaleDeltaPct keeps first + frames whose area changed >= pct", () => {
    // sizes: 10,10,10,20 -> areas 100,100,100,400. vs last-kept(100): frame3 = 300% change
    const anns = [ann(0, 10), ann(1, 10), ann(2, 10), ann(3, 20)];
    expect(ids(keptIds(anns, [{ kind: "minScaleDeltaPct", pct: 50 }]))).toEqual(["a0", "a3"]);
  });

  it("maxPerTrack evenly subsamples down to k (endpoints included)", () => {
    const k = keptIds(range(10), [{ kind: "maxPerTrack", k: 3 }]);
    expect(ids(k)).toEqual(["a0", "a5", "a9"]); // 0, round(4.5)=5, 9
    expect(keptIds(range(3), [{ kind: "maxPerTrack", k: 5 }]).size).toBe(3); // k>=len keeps all
    expect(ids(keptIds(range(4), [{ kind: "maxPerTrack", k: 1 }]))).toEqual(["a0"]);
  });

  it("empty input -> empty", () => {
    expect(keptIds([], [{ kind: "everyN", n: 2 }]).size).toBe(0);
  });
});

describe("keptIds — stacking & order", () => {
  it("ops compose sequentially (each narrows the survivors)", () => {
    // every 2nd of 10 -> a0,a2,a4,a6,a8 ; then maxPerTrack 3 -> endpoints of THAT set
    const ops: ThinOp[] = [{ kind: "everyN", n: 2 }, { kind: "maxPerTrack", k: 3 }];
    expect(ids(keptIds(range(10), ops))).toEqual(["a0", "a4", "a8"]);
  });

  it("order matters", () => {
    const a = keptIds(range(10), [{ kind: "everyN", n: 2 }, { kind: "everyN", n: 2 }]); // a0,a4,a8
    const b = keptIds(range(10), [{ kind: "everyN", n: 4 }]); // a0,a4,a8
    expect(ids(a)).toEqual(ids(b));
  });

  it("is order-sensitive between different op types", () => {
    const scoreThenEvery = keptIds(
      [ann(0, 10, 0.9), ann(1, 10, 0.1), ann(2, 10, 0.9), ann(3, 10, 0.1)],
      [{ kind: "minScore", v: 0.5 }, { kind: "everyN", n: 2 }],
    ); // score->a0,a2 ; every2 of [a0,a2]-> a0
    expect(ids(scoreThenEvery)).toEqual(["a0"]);
  });
});

describe("recomputeExclusions", () => {
  const track = (thinning: ThinOp[]): Track => ({ id: "t1", startFrame: 0, endFrame: 9, prompt: "sail", createdAt: 1, thinning });

  it("sets excluded on filtered-out annotations, leaves others alone", () => {
    const anns = [...range(4), ann(0, 10, undefined, "OTHER")]; // 4 in t1 + 1 in another track
    (anns[4] as any).id = "other-0";
    const out = recomputeExclusions(anns, track([{ kind: "everyN", n: 2 }]));
    const byId = Object.fromEntries(out.map((a) => [a.id, a.excluded]));
    expect(byId["a0"]).toBe(false);
    expect(byId["a1"]).toBe(true);
    expect(byId["a2"]).toBe(false);
    expect(byId["a3"]).toBe(true);
    expect(byId["other-0"]).toBeUndefined(); // untouched (different track)
  });

  it("is idempotent and reversible (empty ops clears exclusions)", () => {
    const anns = range(4);
    const thinned = recomputeExclusions(anns, track([{ kind: "everyN", n: 2 }]));
    const rethinned = recomputeExclusions(thinned, track([{ kind: "everyN", n: 2 }]));
    expect(rethinned.map((a) => a.excluded)).toEqual(thinned.map((a) => a.excluded));
    const cleared = recomputeExclusions(thinned, track([]));
    expect(cleared.every((a) => a.excluded === false)).toBe(true);
  });

  it("does not mutate the input array/objects", () => {
    const anns = range(2);
    const snapshot = JSON.stringify(anns);
    recomputeExclusions(anns, track([{ kind: "everyN", n: 2 }]));
    expect(JSON.stringify(anns)).toBe(snapshot);
  });
});
