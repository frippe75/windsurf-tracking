# Frontend refactor debt register

Tracked so it's not rediscovered. Add a row when you knowingly preserve a quirk or defer a cleanup.
The goal is a FE that can be refactored along clean seams once features settle.

## Preserved quirks (kept EXACTLY during the SAM3 detect/track extraction — behaviour, not bugs to fix here)

These are pinned by tests (`lib/samMapping.test.ts`, `lib/pipelineApi.test.ts`, `hooks/useSamTool.test.ts`)
so a future "fix" is a deliberate, test-visible change — not an accidental regression.

| # | Quirk | Where | Notes / intended fix |
|---|---|---|---|
| 1 | `instanceNumber` is seeded from a **stale `instances` snapshot** per call; in the detect-all loop, numbering can collide across classes (ids still differ). | `lib/samMapping.ts` (`detectionsToAnnotations`/`trackFramesToAnnotations`) | Fix later by threading the accumulated instances through the loop. Behaviour-changing → its own PR. |
| 2 | Two different **"no video id" error strings** (`SamTool.detect` vs the hook's detect-all/track). | `components/SamTool.tsx`, `hooks/useSamTool.ts` | Unify wording when convenient. |
| 3 | `window.__samVideoId` **global** as the video-id channel, and `document.querySelector("video")` DOM reads inside the hook. | `pages/Index.tsx` (sets it), `hooks/useSamTool.ts`, `components/SamTool.tsx` | Replace with a prop/context once the video-player wiring is refactored. |
| 4 | Track poll is **180 × 2 s (~6 min) ceiling**, sleep-before-poll, unknown statuses loop silently. | `lib/pipelineApi.ts` (`pollTrack`) | Fine for now; revisit if endpoints change. |

## Deferred cleanups (not done in the extraction PR to keep it focused/low-risk)

| Item | Why deferred | File(s) |
|---|---|---|
| SamTool prefs (`samMinScore`, `samTrackWindow`) still use ad-hoc `localStorage` instead of the central `settings.ts` store. | Self-contained + works; same defaults. Low value, small risk. | `components/SamTool.tsx`, `lib/settings.ts` |
| SAM2 click masks still stored as `maskBase64` (not polygons). | Single-frame, low volume — not the scale driver. | `pages/Index.tsx` SAM2 sites, backend `/api/ai/sam2` |
| Persistence **Phase 2**: normalized annotation table + incremental delta saves; unify export; kill phantom export-projects; fix the count-vs-blob split. | Big; Phase 1 (polygons) already made the blob ~10× smaller. | `backend/`, `hooks/useProjects.ts`, `lib/projectSync.ts` |
| `Index.tsx` is still ~2470 lines. | The SAM3 orchestration is out; other regions (upload, tracking-jobs, keyframes, scenes) remain inline. | `pages/Index.tsx` |

## Extraction checklist (use for the NEXT pull-out of Index.tsx)

A previous extraction lost functionality. Do it this way:

1. **Inventory first** — write the exact behaviour contract (guards, side-effects, return values, edge
   cases, error strings) of what you're moving. Quote the current code.
2. **Characterization tests first** — pin that behaviour with tests *before* moving anything, so the
   suite proves parity through the change.
3. **Extract pure core** — move logic to a pure module (no React/DOM/fetch) it can be exhaustively tested.
4. **Typed API boundary** — network calls go through a client module (e.g. `lib/pipelineApi.ts`), never
   raw `fetch` in components/hooks.
5. **Mechanical rewire** — the component/hook *calls* the extracted units; no logic rewrite in the same step.
6. **Green gate every step** — `npm run build` + `npm test` (+ pipeline `pytest`) green after each step;
   each step independently shippable.
7. **Preserve exactly** — keep quirks; log them here; any intentional change is a separate PR.
8. **Manual E2E** — for render-only behaviour unit tests can't cover, run the flow on labelbee after deploy.
