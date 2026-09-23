---
title: BackTest — Build Handoff
project: timeless-perspective
type: handoff
status: v1 built, Supabase not yet wired
updated: 2026-09-23
---

# BackTest — Build Handoff

Everything needed to continue the POI backtest capture tool. Written for a fresh
Claude Code session with no prior context.

---

## 1 · What this is

David and one trading partner are running a joint manual backtest program on the
1% Club framework. The premise: they trade a framework they have never measured.
The program builds a dataset large enough that POI quality stops being a matter
of opinion.

**The record has three levels, and the work runs through them in order.**
The POI is the parent record; the entry models it produced hang off it; the price
detail sits inside each entry. The tool captures all three, with voice dictation
at every level.

**No skipping ahead on the analysis, though:**

| Layer | What it measures | Status |
|---|---|---|
| **1 · POI quality** | Does the zone hold, how far does it run, which confluences were present. No entries. | **Building now** |
| **2 · Entry models** | EM3 Aggr., EM3 Cons., FZ Sweep layered onto POIs that already qualified. | **Capture built** — stop *definitions* still open (§6) |
| **3 · Risk tuning** | Which stop, which target, which filters — set by expectancy. | After layer 2 |

If layer 1 shows these zones don't hold often enough, no entry model rescues
them. That result would be worth knowing on its own.

### Objectives

| # | Objective | Done when |
|---|---|---|
| 01 | Log 150–200 mitigated 15m pro-internal POIs | Both traders, all instruments |
| 02 | Rank the confluences by measured lift | Lift table holds at n ≥ 150 |
| 03 | Layer the three entry models onto those POIs | Every entry carries both stops |
| 04 | Set stop and target from the distribution | Expectancy decides, not preference |

Sample size matters: 8 yes/no confluences cut the sample eight ways. Below ~100
rows the tool is only confirming what they already believe. The UI flags any
slice under 30 and prints a caution line that changes with n.

---

## 2 · Layer 1 — locked definitions

These are settled. Do not reinterpret them.

| Term | Definition |
|---|---|
| **Unit of record** | One row per **mitigated 15m pro-internal POI**. Not per trade. |
| **Edge price** | The entry side of the zone — where price first engages it. |
| **Invalidation price** | The far side of the zone. |
| **1R** | `abs(edge_price − invalidation_price)` — the zone's own height. No entry model exists at this layer, so this is the yardstick that puts ES, Gold and FX on one scale. |
| **Failure (layer 1)** | **Invalidation price touched** — wick or close. This layer measures the zone itself. |
| **MFE** | Max favorable excursion from the edge, up to the invalidation touch. Where measurement stops on a zone that holds is **the trader's call**, recorded as a price with no fixed rule. |
| **MAE** | Max adverse excursion before the zone resolved. |
| **Meaningful reaction** | MFE **≥ 2R**. |
| **Wick-through** | Price touched invalidation but no 3m close followed. Counts as a failure at layer 1, and the POI can still produce an entry-model trade at layer 2. This field is what connects the two layers. |
| **POI type — Range** | Zone drawn from a **group of candles**. |
| **POI type — Pivot** | Zone drawn from a **single candle**. Range vs pivot is trader discretion per POI, logged so the data can show whether one method holds better. |
| **Trader** | Logged on every row. Discretion is allowed; discretion is recorded. |

### Qualifying rules — NOT columns

Every logged POI already meets these, so they can't produce lift and must not be
added as fields:

1. **Must lead to a break in structure** — a zone that doesn't is not a POI
2. **Mitigated by price**

### The eight logged confluences

All eight are tick boxes on every row, including pro internal order flow —
David's call, so each row carries an explicit confirmation rather than an
assumption. Expect `conf_pro_internal` to read yes on nearly every row while the
study stays pro-internal only; it will produce little lift until counter-internal
POIs are also logged. That is a deliberate discipline checkmark, not an
analytical variable.

| Key | Name | Definition |
|---|---|---|
| `conf_pro_internal` | Pro internal order flow | Aligned with the HTF narrative and 15m internal structure — who controls price, continuation or pullback |
| `conf_liquidity` | Liquidity & inducement | Swept liquidity, liquidity resting beyond it, where it was taken, high- vs low-resistance |
| `conf_flip` | Flip | Caused a failed reaction and a supply/demand flip |
| `conf_pd` | Within premium/discount | Well priced — demand in discount, supply in premium |
| `conf_unmitigated` | Unmitigated | Fresh, efficient when created, not already reacted to |
| `conf_chain` | Part of an S&D chain | Belongs to a chain of mitigations |
| `conf_htf_stack` | Stacked in an HTF POI | This MTF POI sits inside a higher-timeframe POI |
| `conf_push` | Push liquidity | Pre-BOS liquidity fuelling the move into or through the POI |

> The framework's "other factors" confluence bundled three separate things:
> HTF stacking, imbalance/momentum, and corrective vs impulsive delivery. Logged
> as one yes/no it is un-analyzable, so only the HTF stacking test was kept.
> **Open question for David:** split the other two out as their own columns?

---

## 3 · Layer 2 — entry models (capture built)

Captured as a `jsonb` array on the POI row: 0..2 entries per POI, each with its
own dictation box, prices and both stops. The *field structure* is settled; the
written *stop definitions* for two of the three models are not (§6), so those
fields exist but the rule for filling them is still pending.

Per entry: model, entry time, entry price, stop 1, stop 2, MFE, MAE, technical
target, 3R / 5R / target reached, result, notes. R is computed against both
stops from the same move.

**Three entry types, two stops each. Every entry produces two R readings from one
move, so the data picks the stop.**

| Model | Entry | Stop 1 (aggressive) | Stop 2 (conservative) |
|---|---|---|---|
| **EM3 Aggr.** | The fMS-low sweep, taken immediately | Below the liquidation candle | Below the zone |
| **EM3 Cons.** | The flip zone sweep following a working EM3 Aggr. (Entry 2; Entry 1 → breakeven) | **PENDING** | **PENDING** |
| **FZ Sweep** | Flip zone swept with a clear sweep on 1m, taken alone. Terminal — no EM3 Aggr./Cons. follows | **PENDING** | **PENDING** |

One FZ sweep stop definition covers two models, since EM3 Cons. *is* a flip zone
sweep entry.

**Layer 2 rules:**
- Failure = a **3m close beyond the POI** (different from layer 1, where a touch
  is enough)
- Max **2 attempts or 2 losses** per POI
- A failed EM3 Aggr. does **not** invalidate the POI — it stays in play until the
  cap or the 3m-close guardrail

### The decision tree (confirmed)

```
Wait for POI mitigation
  │
  └─ Push liquidity present? (inside the POI)
        │
        ├── NO ──────────────────────────────┐
        │                                     │
        └── YES                               │
              └─ Mitigation sweep also        │
                 triggers EM3 Aggr.?          │
                   ├─ YES → Enter EM3 Aggr.   │
                   └─ NO ───────────────────┐ │
                                            ▼ ▼
                        Wait for 1m MSS / 3m fMS
                                    │
                          Flip zone present?
                     ┌──────────────┴──────────────┐
              No flip zone                  Flip zone present
                     │                              │
                     │                      Attempt FZ sweep entry
                     │                       ├─ Triggers → ENTER (TERMINAL:
                     │                       │   no EM3 Aggr./Cons. follows)
                     │                       └─ Fails ─────┐
                     └────────► EM3 Aggr. attempt ◄────────┘
                                    │
                        ┌───────────┴───────────┐
                   Triggers                   Fails
                        │                       │
              Enter EM3 Aggr.          2 attempts/losses,
              (stop 1 or 2)            or POI closed (3m)?
                        │                ├─ No  → retry EM3 Aggr.
              EM3 Aggr. creates MSS      └─ Yes → no trade
                        │
              Look for EM3 Cons.
              (FZ sweep, may be a fresh zone)
                        │
              Enter EM3 Cons. — Entry 2
              (EM3 Aggr. stop → breakeven)
```

Guardrail throughout: a 3m close beyond the 15m POI invalidates the POI.

---

## 4 · What was built

### `poi-backtest.html` (repo root, ~54KB)

Single file, vanilla JS, no build step. Matches the site's existing tool pattern.
Four tabs:

- **Log** — three levels on one screen: the POI form (with its dictation box),
  then an Entry models section where each entry is its own card with its own
  dictation box, prices, both stops and a live two-stop R readout. Two entry
  paths at every level by design: dictate and parse, or type straight into the
  fields. Parsing never blocks manual entry.
- **Data** — all rows newest-first, two CSV exports (one row per POI, and one row
  per entry with both stops' R), per-row **edit** and delete, chart links. Edit
  loads the POI *and its entries* back into the Log form (banner + "Update POI"),
  so a row logged quickly from the phone can be corrected later at the desk.
- **Analysis** — filters (trader / instrument / year / POI type) → tiles, MFE
  distribution (≥1R…≥10R with the 2R line marked), confluence lift table sorted
  by lift with low-n chips, an entry-model table (per model, both stops side by
  side: n, avg MFE, hit rates at 3R / 5R / technical target, expectancy at 5R),
  and a sample-size caution that changes with n.
- **Definitions** — every term above, rendered in-page so both traders read the
  same definition while logging. Includes the open decisions.

**Storage adapter** (`store.list/add/remove`) with two modes:
- Blank config → `localStorage` under `ttp_poi_backtest_v1` (works immediately)
- Config filled → Supabase via CDN (`@supabase/supabase-js@2.45.4`, jsDelivr UMD)

Config block is at the top of the `<script>`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`TABLE`, `LS_KEY`.

**Voice input design decision:** deliberately NOT `webkitSpeechRecognition` —
unreliable on iOS Safari and needs mic permission every session. Instead a large
textarea the user fills with the **iPhone keyboard's own dictation button**, then
`parseDictation()` extracts fields with regex heuristics and marks what it filled
(`.parsed` class, gold border) for correction. Extend the keyword lists in
`parseDictation()` as real dictation patterns emerge — that function is the main
thing worth tuning after a few real sessions.

R maths (`computeR`) is direction-aware:
```
risk = |edge − invalidation|
long:  mfeR = (mfe − edge) / risk     short: mfeR = (edge − mfe) / risk
long:  maeR = (edge − mae) / risk     short: maeR = (mae − edge) / risk
```

### `scripts/poi-backtest-schema.sql`

Table `public.poi_backtest`, indexes on date/trader/instrument, RLS enabled, plus
two commented access options (see §5).

### `index.html`

BackTest card added to the `TOOLS` array (id `poi-backtest`, icon 🔬).

---

## 5 · Remaining setup

1. **Preview locally** — works now in localStorage mode, no setup needed.
2. **Run** `scripts/poi-backtest-schema.sql` in the Supabase SQL editor.
3. **Paste** project URL + anon key into the CONFIG block.
4. **Harden access before the page is public** — see below.

### ⚠ Security decision — unresolved

The page is now linked from the homepage TOOLS menu, and the Supabase anon key
ships in the page source. With the schema's **Option A** policies, any visitor
can write rows into the research data.

**Option B** in the schema file restricts access to two named email addresses via
Supabase Auth — about five lines of RLS plus one `signInWithOtp` call in the
page. Magic-link sign-in persists per device, so it is a one-time step per phone
or laptop. Recommended before pointing the page at a real database, since the
card's own description promises "saved securely to a database."

### ⚠ Repo credential — action required

`.git/config` has a **GitHub personal access token embedded in plaintext** in the
remote URL. It has been exposed in session logs. Revoke it at
github.com/settings/tokens and switch to SSH:

```
git remote set-url origin git@github.com:petro2458-wq/timeless-perspective.git
```

---

## 6 · Open decisions — blocking layer 2

All three need David + partner agreement. Each changes what gets logged, so they
are settled **before** entry-model capture is built.

1. **FZ sweep stops** — an aggressive and a conservative stop for the flip zone
   sweep. One definition covers both EM3 Cons. and FZ Sweep.
2. **3m or 15m liquidation candle** — whether EM3 Aggr. should sometimes wait for
   the 15m candle rather than the 3m that liquidates.
3. **Setups before push liquidity is taken** — when push liquidity is unswept and
   an FZ sweep or EM3 Aggr. presents anyway: skip it, or log it untraded and let
   the data judge? (David's lean: log untraded.)

Also open, smaller: whether to split the framework's "other factors" confluence
into imbalance/momentum and corrective-vs-impulsive columns (§2).

---

## 7 · Site conventions

Read `CLAUDE.md` in the repo root — but note it has **drifted**. It claims a rose
accent (`#d4537e`) and Playfair Display. The actual tool pages use **gold
`#c9a55a`** and **Cormorant Garamond**. Follow the tool pages, not CLAUDE.md, and
consider correcting CLAUDE.md.

- **Stack:** pure HTML, no framework, no npm, no build. React 18 + Babel via CDN
  only where a page needs it; `poi-backtest.html` uses neither.
- **Hosting:** Vercel static. Every push to `main` auto-deploys.
- **Design tokens:** CSS variables in `:root` per file. Never hardcode colors.
- **Fonts:** Cormorant Garamond (display), DM Sans (body), JetBrains Mono (data).
- **Layout:** `.nav` → `.hero` → content. Tool pages use a two-column grid
  collapsing at `@media(max-width:900px)`.
- **Charts elsewhere on the site:** vanilla Canvas 2D with devicePixelRatio
  scaling, no chart library. `poi-backtest.html` uses CSS bars instead — no
  canvas needed yet. If a real chart is added later, follow the canvas pattern in
  `trade-tracker.html`.

---

## 8 · Filing in DavidOS

Vault project folder (per `CLAUDE.md`): `DavidOS/03-projects/timeless-perspective/`

File this handoff and any derived notes there following the vault's own
conventions — read the vault's agent instructions / CLAUDE.md before writing, and
match existing frontmatter, folder structure and naming. Do not invent a new
structure.

Suggested notes to maintain in the vault, kept in sync as decisions land:
- The three open decisions (§6) — update as each is settled
- The locked definitions (§2) — the single source of truth both traders cite
- Session log of what changed in the tool and why

---

## 9 · Related artifacts

Built earlier in the planning sessions, useful for context and for briefing the
partner:

- **Goal sheet** (interactive, illustrative data — shows what the finished
  analysis looks like): https://claude.ai/artifact/9uVmb7P862YryjhKGgRhDs
- **Slide deck** (14 slides, partner briefing, speaker notes):
  https://claude.ai/artifact/GuSy3b1TNjJ4dhYdcGfTq7

Both are private until shared from each page's Share menu.

---

## 10 · Suggested next tasks

1. Wire Supabase + Option B auth, then log 10 POIs side by side with the partner
   to surface definition disagreements at row 10 rather than row 120.
2. Tune `parseDictation()` against real dictation transcripts.
3. Settle §6 — the entry fields are built, but two of the three models have no
   agreed stop definition yet, so those columns will hold inconsistent data until
   the rule is written down.
