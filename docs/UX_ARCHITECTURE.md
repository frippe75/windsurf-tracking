# UX Architecture & Guidelines — LabelBee (windsurf-tracking)

> **Purpose.** A durable framework for *where* things live and *when* they appear,
> so the platform can grow for years without turning into a wall of buttons. It is
> **opinionated about structure, not about features** — it never says which
> capabilities may exist; it says every capability must have a clear home and a
> reason to be on screen. New work conforms to this; this doc changes rarely.
>
> **The contract (read this if nothing else).** No feature ships as a loose button.
> Every UI addition answers three questions: **(1) what is its scope?** →
> [§3 placement](#3-where-does-it-go--the-placement-rule) picks the region;
> **(2) when is it relevant?** → [§4 disclosure](#4-progressive-disclosure--context-awareness)
> decides if it's always-on or contextual; **(3) does it reuse the kit?** →
> [§5 consistency](#5-consistency-kit). If those three are answered, it fits by construction.

---

## 1. Principles (the north star)

1. **Context over chrome.** A control is on screen only when it's actionable *now*.
   At-rest and empty states teach the next step instead of showing everything.
2. **One home per concept.** Identity, project, tools, the selected object, view,
   and dev each own exactly one region. A new feature joins the matching region —
   it does not open a new slot in the top bar.
3. **The stage is sacred.** The video + overlays are the focus. Chrome is quiet,
   recedes, and never competes with the content.
4. **Consistency is a system, not a coat of paint.** A small kit of primitives
   (button tiers, toggles, panels, toasts, shortcuts) is reused everywhere.
5. **Safe and durable by default.** Destructive actions confirm; work persists;
   nothing is silently lost.
6. **Desktop and touch are peers.** Every action is reachable both ways — a
   shortcut on desktop *and* a visible control on touch. Neither is second-class.
7. **Extend by placement, not accretion.** Growth happens by slotting into a
   region or a registry (tools, init-methods, export sinks, AI models), never by
   appending another top-level button.

---

## 2. Layout regions (the skeleton)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOP BAR — identity & context (never an action dumping ground)              │
│  ◇ app + version    ◇ active project (name · switch)          ◇ user menu   │
├───────────┬──────────────────────────────────────────────┬───────────────┤
│ LEFT RAIL │                                              │ RIGHT RAIL     │
│ modes &   │                 STAGE                         │ inspector /    │
│ tools     │        video + overlays (the content)        │ context panel  │
│           │                                              │ (selection,    │
│ (annotate,│                                              │  classes,      │
│  select,  │                                              │  properties)   │
│  tool     ├──────────────────────────────────────────────┤ — contextual   │
│  options) │  TRANSPORT + TIMELINE (frames, keyframes)     │                │
└───────────┴──────────────────────────────────────────────┴───────────────┘
   overlays: toasts (top-right) · modals · command palette · dev drawer
```

| Region | Owns | Does **not** hold |
|---|---|---|
| **Top bar** | App identity + version, active-project context, the single user menu | Feature actions, tool toggles, dev controls |
| **Left rail** | Interaction *modes* (annotate/select) and the active tool's options | Object data, project actions |
| **Stage** | The video and its overlays (masks, boxes, prompts) | Persistent chrome |
| **Transport / timeline** | Playback, scrubbing, frame/keyframe markers | Object properties |
| **Right rail (inspector)** | The current context: selected object's actions, classes/instances, properties | Global/app actions |
| **Overlays** | Transient: toasts, modals, command palette | Anything that must stay visible |
| **Dev drawer** | Diagnostics (backend selector, build info, feature flags), de-emphasized | Anything a normal user needs |

---

## 3. Where does it go? — the placement rule

Classify every action by **scope**, then its region is fixed. This table *is* the
extensibility engine: a new feature is placed by looking up its scope.

| Scope of the action | Home | Examples |
|---|---|---|
| **Identity / account** | Top-right **user menu** | login state, logout, profile, prefs |
| **Project / dataset** | **Project surface** (project menu / Project Manager) | create, open, rename, delete, **export**, dataset settings |
| **Interaction mode / tool** | **Left tool rail** | annotate, select, bbox-drag, DINO-text (as a tool), tool options |
| **Selected object** | **Right inspector** (+ on-canvas handles) | rename/reclass instance, delete annotation, per-object prompts |
| **View** | **View controls** at the stage edge | zoom, maximize, overlay toggles, labels |
| **Frame / time** | **Timeline** | add/remove keyframe, jump, mark scene |
| **Destructive / rare** | Inside the owning surface, **behind a confirm** | delete project/video/class |
| **Dev / diagnostic** | **Dev drawer**, icon-only, de-emphasized | backend selector, version, flags |

**Pluralizable capabilities go in a registry, not as buttons.** Tools/init-methods,
export sinks, and AI models each render from a list, so adding one grows a menu by
one row instead of adding a control to the chrome. (The export-sink plugin pattern
already works this way — mirror it.)

---

## 4. Progressive disclosure — context-awareness

The app should feel *smart*: infer and hide rather than show-everything-disabled.

| State | What's shown |
|---|---|
| No video loaded | One empty-state CTA (Add video). Tools/inspector absent. |
| Video, nothing selected | Tools available; inspector shows project + classes overview. |
| Object selected | Inspector shows *that object's* actions; on-canvas handles appear. |
| A mode is active (e.g. annotate) | Only that mode's options show (e.g. the +/− prompt affordance — and only on touch). |
| Long operation running | Progress in place; the trigger disables; result → toast. |

Rules of thumb: prefer **hiding** an inapplicable control over disabling it; show
counts/badges only when non-zero; never show two controls for the same concept.

---

## 5. Consistency kit

- **Button tiers:** exactly one **primary** per context; **secondary** for common
  alternatives; **ghost/icon** for tertiary. Don't escalate importance with size.
- **Modes vs toggles vs actions** each have a distinct, consistent visual (a mode
  is sticky and mutually-exclusive; a toggle is on/off; an action fires once).
- **Icons** always pair with a label, except in dense rails where a tooltip
  suffices. One icon = one meaning across the app.
- **Feedback:** transient results → toast (top-right); validation → inline; long
  ops → in-place progress. Never a toast for something that needs to persist.
- **Keyboard:** every shortcut has a visible equivalent and is listed in Help (`?`).
  Modifiers are consistent (e.g. Ctrl = positive, Alt = negative for prompts).
- **Touch:** every desktop-shortcut action has a visible touch control; width
  breakpoints (`sm`) gate desktop-only vs touch-only affordances.
- **Vocabulary (use these words consistently):** *class* (label) → *instance* (a
  physical object) → *annotation* (a per-frame mark) → *segment/mask* → *track* →
  *dataset/export*. Verbs name actions, nouns name things.

---

## 6. Applying it now (the clutter you flagged)

These are the framework applied — worked examples, not new opinions.

| Today | Problem | Per the framework |
|---|---|---|
| Top bar has a standalone **Logout** *and* **Login** button *and* a UserMenu | Three controls for one concept; login belongs on `/login` | **One** identity control: the user menu (top-right). Remove the standalone Logout/Login; logged-in shows only the menu (with logout inside). [§2, §3 identity] |
| **Export** button in the top bar | It's project-scoped, not global | Move into the **Project surface** (project menu / Project Manager actions). [§3 project] |
| **BackendSelector** dropdown, oversized with text | It's a dev tool sitting in user chrome | **Dev drawer**, icon-only; reveal the endpoint list on open (drop the label text). [§2 dev, §3 dev] |
| **Projects** *and* **My Projects (Old)** buttons | Two homes for one concept | Consolidate to one Project entry point. [§2 one-home] |
| Header title carries a hardcoded version string | Duplicate of the build version tag | Single source: the build-version tag under the logo. [§5 consistency] |

---

## 7. Extension checklist (put in every UI PR description)

- [ ] **Scope** identified → placed in the matching region (§3).
- [ ] **Disclosure** decided → always-on *or* contextual, with the trigger state (§4).
- [ ] **One home** — not duplicating an existing concept/control (§1.2).
- [ ] **Kit reuse** — button tier, toggle/mode/action, icon+label, feedback (§5).
- [ ] **Desktop + touch** both covered; shortcut listed in Help (§1.6, §5).
- [ ] If it's a *pluralizable* capability, it's a **registry row**, not new chrome (§3).

---

## 8. What this is NOT

- Not a fixed screen mock and not a list of allowed features. It constrains
  **where** and **how**, never **what**. Any future capability — DINO text-propose,
  new export sinks, review workflows, multi-video datasets — fits by construction.
- Not a visual style guide (colors/spacing live with the component library); this
  is the *architecture* those styles hang on.

---

*Keep this doc small and stable. If a change here is needed, it should be a
structural decision (a new region, a new scope), not a per-feature tweak.*
