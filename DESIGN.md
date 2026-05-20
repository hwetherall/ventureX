# Design System — VentureX

**Status:** v1, ratified 2026-05-15 via `/design-consultation`.
**Source of truth:** this file. Update via PR; never deviate silently.

---

## 1. Product Context

- **What this is:** Internal competitive-landscape tool for management consultants. Document intake → LLM extraction → human-in-the-loop refinement → dimension weighting → (Phase 3+) competitor candidate generation.
- **Who it's for:** Senior consultants at Innovera (Harry, Pedram, DPZ team). Sophisticated users; not customer-facing.
- **Space:** Internal B2B tooling, adjacent to Linear, Notion, Stripe Dashboard, Vercel.
- **Project type:** Data-heavy web app — long structured forms, dimension weighting sliders, eventually ranked tables.
- **Memorable thing:** "Serious software for serious work." Every design decision tests against this.

---

## 2. Aesthetic Direction

- **Direction:** Industrial-utilitarian. Linear/IBM-shaped.
- **Decoration level:** Minimal. Typography and whitespace lead. No gradients, illustrations, decorative borders, or background blobs.
- **Mood:** Calm, dense, audit-trail-clean. Trust-critical because output gets cited in client work.
- **Reference points:** Linear (density + craft), Vercel Dashboard (restraint), Stripe Workbench (data legibility), Plain (typographic confidence).
- **Anti-patterns to never adopt:** purple gradients as default accent, 3-column feature grids with icons in colored circles, centered-everything marketing layouts, bubble-radius on big containers, decorative AI-slop hero sections.

---

## 3. Typography

- **Body / UI / Headings:** **IBM Plex Sans** (Google Fonts). Weights 300/400/500/600. Humanist warmth + tabular-nums; designed exactly for "serious software." Avoids the Inter / Geist / Roboto convergence trap.
- **Code / IDs / Tabular data:** **IBM Plex Mono**. Paired family. Used on `venture_id` slices, `version_number` badges, JSON snippets, source filename labels, command examples.
- **Loading:** `next/font/google` in `src/app/layout.tsx`, exposed as CSS variables `--font-plex-sans` and `--font-plex-mono`.
- **Scale (px / Tailwind class):**
  - `text-xs` 12px — metadata, badges, field labels (small-caps), small print
  - `text-sm` 14px — body, form inputs, button labels
  - `text-base` 16px — panel section labels
  - `text-lg` 18px — section headings
  - `text-2xl` 24px — page title (`Refine 7a3f2e4c`)
- **Weight discipline:**
  - `font-normal` (400) for body
  - `font-medium` (500) for emphasis (button labels, panel titles)
  - `font-semibold` (600) for section headings
  - Never `font-bold` (700+) unless explicitly justified — reads heavy at small sizes
- **Tracking:** `tracking-tight` on `text-2xl` headings; default elsewhere. `tracking-wide uppercase` on `text-xs` field labels.

---

## 4. Color

**Approach:** Restrained — neutral spine + one accent + semantic. The accent is rare and meaningful.

### Light mode

| Token | Value | Usage |
|---|---|---|
| `--background` | `zinc-50` (#fafafa) | Page background |
| `--surface` | `white` | Cards, panels, inputs |
| `--border` | `zinc-200` (#e4e4e7) | Hairlines |
| `--foreground` | `zinc-900` (#18181b) | Primary text |
| `--muted-foreground` | `zinc-500` (#71717a) | Secondary text, labels |
| `--accent` | `indigo-600` (#4f46e5) | Primary CTAs, load-bearing left rule, links |
| `--accent-hover` | `indigo-700` (#4338ca) | Hover state on accent |
| `--warning-fg` | `amber-700` (#b45309) | Critic flag text |
| `--warning-bg` | `amber-50` (#fffbeb) | Critic flag background |
| `--warning-border` | `amber-200` (#fde68a) | Critic flag hairline |
| `--success-fg` | `emerald-700` (#047857) | "Saved" state |
| `--error-fg` | `red-700` (#b91c1c) | Error text |
| `--error-bg` | `red-50` (#fef2f2) | Error background |

### Dark mode (THE PRIORITY FIX from 2026-05-15 feedback)

| Token | Value | Usage |
|---|---|---|
| `--background` | `zinc-950` (#09090b) | Page background |
| `--surface` | `zinc-900` (#18181b) | Cards, panels |
| `--surface-elevated` | `zinc-800/40` (#27272a at 40%) | Load-bearing emphasis surface |
| `--border` | `zinc-800` (#27272a) | Hairlines |
| `--foreground` | `zinc-50` (#fafafa) | Primary text |
| `--muted-foreground` | `zinc-400` (#a1a1aa) | Secondary text, labels |
| `--accent` | `indigo-400` (#818cf8) | Primary CTAs, load-bearing left rule, links |
| `--accent-hover` | `indigo-300` (#a5b4fc) | Hover on accent |
| `--warning-fg` | `amber-300` (#fcd34d) | Critic flag text |
| `--warning-bg` | `amber-950/40` (#451a03 @ 40%) | Critic flag background |
| `--warning-border` | `amber-800/40` (#92400e @ 40%) | Critic flag hairline |
| `--success-fg` | `emerald-400` (#34d399) | "Saved" state |
| `--error-fg` | `red-400` (#f87171) | Error text |
| `--error-bg` | `red-950/40` (#450a0a @ 40%) | Error background |

**Critical rule:** never use Tailwind's light-mode-only color shorthands (`text-amber-900`, `bg-red-50` etc.) without an explicit `dark:` variant. The pre-design-consultation code did this and it was the #1 readability complaint. Always pair light/dark, OR use the semantic CSS variables above.

---

## 5. Spacing

- **Base unit:** 4px (Tailwind default).
- **Density:** Comfortable, not compact. Consultants read for 30+ min stretches.
- **Form rhythm:** `space-y-5` (20px) between fields within a panel. `space-y-10` (40px) between dimension panels. `mt-8` (32px) between major sections of a page.
- **Container padding:** `p-4` (16px) on cards. `px-6 py-12` on page main.
- **Form max-width:** `max-w-3xl` (768px). Comfortable line length for editing long strings.

---

## 6. Layout

- **Approach:** Grid-disciplined. Predictable column alignment, consistent gutters.
- **Page shells:** Centered single column for data-form pages (`max-w-3xl`). Sidebar nav for venture lists and weights views when those land (M11+).
- **Sticky headers:** The refine page's panel headers stick on scroll so you always know which dimension you're editing.
- **Border radius scale:**
  - `rounded` (4px) — inputs, buttons, small badges
  - `rounded-md` (6px) — cards, section containers
  - `rounded-lg` (8px) — modals (when introduced)
  - `rounded-full` — confidence pips, status badges only
  - **Forbidden:** `rounded-xl` and `rounded-2xl` on big containers. Bubble-radius signals consumer product, not B2B tool.

---

## 7. Motion

- **Approach:** Minimal-functional. Internal tools punish gratuitous motion.
- **Allowed:** button hover opacity (100ms), save-success fade (150ms ease-out), critic flag expand/collapse (150ms ease-out), modal/toast enter (200ms ease-out).
- **Forbidden:** scroll-driven animations, page transitions, entrance animations on initial load, decorative micro-interactions.
- **Easing:** prefer `ease-out` for everything. `ease-in-out` only for transient state changes that need to feel symmetric.
- **Duration tokens:** `micro` 100ms, `short` 150ms, `medium` 200ms. Never longer than 200ms for anything user-triggered.

---

## 8. Component Conventions

### Buttons

- **Primary:** `bg-accent text-white hover:bg-accent-hover rounded px-3 py-1.5 text-xs font-medium` (in semantic tokens). Used for Save, Confirm, primary actions.
- **Secondary / outline:** `border border-border bg-surface hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded px-3 py-1 text-xs`. Used for Accept Suggestion, dismissive actions.
- **Destructive (× delete):** `border border-border rounded px-2 py-1 text-xs hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-400`.
- **Disabled:** `disabled:opacity-40 disabled:cursor-not-allowed`. Never hide disabled buttons; surface why they're disabled in inline text.

### Form fields

- **Text input / textarea:** `rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30`.
- **Field label:** `text-xs font-semibold uppercase tracking-wide text-muted-foreground` above the field.
- **Field-level critic flag:** inline below the field, `text-xs text-warning-fg`, with severity tag `[Severity]` in `font-medium`.

### Load-bearing field emphasis (the differentiator)

`substitution_landscape` and `strategic_risks_and_uncertainties` get visual weight that maps to their downstream importance. Pattern:

```
<div class="border-l-2 border-accent bg-surface-elevated rounded-r p-3">
  <FieldLabel ... />
  ...the array editor inputs...
</div>
```

The 2px indigo left rule + slightly elevated surface signals "this field is load-bearing." No other styling differentiates it. **Apply this pattern only to fields explicitly flagged as load-bearing in CLAUDE.md §8** — currently `substitution_landscape` and `strategic_risks_and_uncertainties.implies_search_for`.

### Critic flags

- **Inline display:** below the flagged field, no collapsible. The collapsible "Show reviewer notes" block at panel top is DEPRECATED — flags should always be visible inline.
- **Format:** `[Severity] {comment}` in `text-xs text-warning-fg`. Severity tag in `font-medium`.
- **"Accept suggestion" action:** when a critic flag's parent dimension has `suggested_edits` text, render a small secondary button next to the flag: "Accept suggestion" that adopts the critic's text into the field. One-click HITL.

### Badges / pills

- `rounded bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono` for version numbers, IDs.
- `rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs font-medium` for status labels.
- `rounded bg-warning-bg text-warning-fg px-2 py-0.5 text-xs font-medium` for "N reviewer flags" pill.

### Confidence pip

- `rounded font-mono text-xs px-2 py-0.5` colored by value:
  - `≥ 0.7`: `bg-zinc-200 dark:bg-zinc-800 text-foreground`
  - `< 0.7`: `bg-warning-bg text-warning-fg` (signals low confidence — reviewer should look here)

---

## 9. Save UX (interaction pattern, not visual)

**The save button is ALWAYS active.** Saving a dimension with no changes still creates a `profile_versions` row with `source='human_refined'` — the audit trail signals "reviewer reviewed this dimension, approved as-is." Per-spec audit benefit; matches CLAUDE.md §10's "save explicitly per dimension" requirement.

**Two visual states:**
- Unchanged: button label is "Mark reviewed", subtle (`border border-border bg-surface`).
- Dirty: button label is "Save dimension", primary (`bg-accent text-white`).

Both create a `human_refined` row. The distinction is purely UX clarity for the reviewer.

---

## 10. Dark Mode Strategy

Dark mode is a first-class design surface, not an afterthought. The 2026-05-15 feedback flagged dark mode as the #1 readability issue.

- Always pair light/dark variants on color tokens. Never use a Tailwind color shorthand without a `dark:` counterpart.
- Reduce saturation 10-20% in dark mode for warm colors (amber). Cool colors (indigo, emerald) can stay close to their light values because dark backgrounds eat saturation.
- Background hierarchy in dark mode: page `zinc-950` → surface `zinc-900` → elevated `zinc-800/40`. The contrast steps must be small but legible.
- Text contrast: primary `zinc-50` (98% white), muted `zinc-400`. Anything in between (`zinc-300`, `zinc-500`) is forbidden — too low contrast.

---

## 11. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-15 | Initial design system | Created by /design-consultation. Memorable thing: "Serious software for serious work." |
| 2026-05-15 | Pick IBM Plex Sans over Inter / Geist | Convergence trap — every AI-built UI uses Inter. Plex signals "serious software" without trying to be trendy, free, has tabular-nums, paired Mono available. |
| 2026-05-15 | Single indigo accent (`indigo-600` light / `indigo-400` dark) | One accent used rarely + meaningfully > multi-color palette. Matches the "restrained" approach. |
| 2026-05-15 | Load-bearing field emphasis (2px left rule + elevated surface) | Visual hierarchy maps to data hierarchy. `substitution_landscape` and `strategic_risks` are load-bearing for Phase 3; the UI should tell the user that, not bury them in a uniform form. |
| 2026-05-15 | Always-active save button with "Mark reviewed" vs "Save dimension" labels | Fixes "I have to manually edit things to save it" friction. Both states create audit-trail rows; visual distinction is purely UX. |
| 2026-05-15 | Inline critic flags only (deprecate collapsible "Show reviewer notes") | Flags need to be impossible to miss. Collapsed-by-default hides them; the inline display was already present and is sufficient. |
| 2026-05-15 | Strict dark-mode pairing rule on all color tokens | The pre-design-consultation code used `text-amber-900 on amber-50` style classes that inverted badly in dark mode. New rule: never use a Tailwind color shorthand without an explicit dark variant or a semantic CSS variable. |
| 2026-05-19 | M15 cell-confidence tri-state visual treatment | `verified` → semantic accent (indigo, signals trust); `inferred` → muted-foreground / zinc-neutral (no special chrome); `unknown` → warning treatment (amber bg + amber fg) signalling "consultant should review this". The unknown state is honest about gaps; the warning treatment surfaces it to verification without making it feel like a system error. |
| 2026-05-19 | Tier 3 cells get the 2px indigo left rule | Mirrors the load-bearing field treatment from `substitution_landscape` — Tier 3 is the venture-specific differentiator, the architecture's "wedge" against Competely. Visual hierarchy maps to data hierarchy: the work that justifies M15 vs the upstream pattern lives in Tier 3, so it gets the visual emphasis. |

---

## 12. What's deferred

- **Sidebar nav.** Anticipated for the venture list page and weights view (M11+). Pattern will be Linear/Notion-style — narrow sidebar (240px), header bar inside the main column.
- **Toast notifications.** Currently we use inline save-result text below the button. When we get to multi-action pages (M11 weights UI), introduce a small toast component.
- **Empty states.** Most pages today have one. M11+ will introduce more (no ventures yet, no candidates yet) — design will be a centered short prose block, no illustrations.
- **Data tables.** When the venture list / Phase 3 candidate ranking arrives, tables need a separate spec — column alignment, tabular-nums, hover rows, sortable headers.

---

*Last updated: 2026-05-15. Created via `/design-consultation`. Update this file via PR before changing any UI surface — the file is the contract.*
