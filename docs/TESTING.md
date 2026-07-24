# Testing Requirements

> **The rule:** every change — a one-line helper or a whole subsystem — ships **with tests**, and
> **raises** coverage for the code it adds *and* the existing code it touches. Coverage ratchets up,
> never down. No feature/fix/refactor merges without green suites.

This is a hard requirement, not a suggestion. It is additive: adding tests must never remove or weaken
existing tests ("without clobbering other work").

---

## 1. What must be tested

| Change | Required tests |
|---|---|
| **New pure function / helper / lib** (`lib/*.ts`, backend `*/…` pure modules) | Unit tests for the behavior + edge cases (empty, invalid, boundary). |
| **New endpoint / route** | A route-exists assertion **and** a behavior test (happy path + at least one error/guard) using fakes. |
| **New component** | Extract the logic into a pure hook/util and test that; render-only components need at least a smoke/props test. |
| **New port + adapter** (frames store, repo, sink, format, handle) | Test the port against an **in-memory fake**, plus the real adapter with mocked IO (monkeypatched `storage`, mocked `fetch`/`urllib`). |
| **Touching existing code** | Add or extend a test that pins the behavior you changed. If it wasn't covered, cover it now (the "boy-scout" ratchet). |
| **Bug fix** | A regression test that fails before the fix and passes after. |
| **Refactor / extraction** | **Characterization tests first** (pin current behavior), keep the suite green at each step — behavior preserved exactly. |

## 2. How we test here (established patterns — reuse them)

- **Ports & adapters make things testable.** Keep IO (S3/DB/ffmpeg/network/ML) behind a `Protocol` and
  test the core with a fake: `InMemoryFrameStore`, `InMemoryDatasetVersionRepository`,
  `InMemoryLineageRepository`, fake model handles. The core needs **no** cloud/GPU to test.
- **Separate pure logic from heavy deps.** e.g. `detect_utils.py` / `train_entry.build_metrics` are pure and
  unit-tested; the FastAPI/ultralytics/boto3 glue is thin. Do the same for new code.
- **Backend / pipeline (`pytest`):** mocked `urllib`/`boto3` for handles; `monkeypatch` the `storage`
  module for repositories; force structured outputs in fakes. Route tests build the app and assert routes.
- **Frontend (`vitest`):** pure `lib/*` fully unit-tested; API clients with a queued **mocked `fetch`**
  (record calls + assert request shape); hooks with `@testing-library/react`; inject `sleep`/timers so
  polling loops test instantly (no real timers).
- **Determinism:** no real clocks/network/sleeps in tests — inject them (`clock=…`, `sleep=…`).

## 3. The gate (run before every MR)

```
# frontend
cd frontend && npm run build && npm test -- --run
# backend
cd backend && python -m pytest -q
# pipeline engine + service
python -m pytest pipeline_engine/tests pipeline_service/tests -q
```

CI runs `test-frontend` (`npm ci && npm test`), `test-backend`, and `test-pipeline`. A red suite blocks
the merge — fix or add tests, never disable them. The live LLM/GPU evals stay opt-in (gated by env) so CI
is deterministic and free.

## 4. Coverage expectation

- New code: aim for **all non-trivial branches** covered (happy path + guards + one failure mode).
- Touched code: leave it **better covered than you found it**.
- Prefer a few **meaningful** tests (behavior, contracts, regressions) over brittle snapshot noise.
- If something is genuinely hard to test, that's a design smell — extract the logic behind a seam and test
  the seam.

## 5. Don't clobber

- Never delete or `.skip` an existing test to make a change land — fix the test or the code.
- Additive by default: new test files alongside the code (`foo.ts` → `foo.test.ts`; `module.py` →
  `tests/test_module.py`).
