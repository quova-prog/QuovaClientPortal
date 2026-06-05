# Window Forwards — Design Spec

> **Status:** Approved (design phase) · **Revised after domain-expert review (rev 2)**
> **Date:** 2026-06-04
> **Author:** Steve LaBella + Claude (brainstorming session)
> **Feature:** Add window forwards as a first-class hedging instrument across Quova,
> alongside outright forwards, FX swaps, options, and spot.

---

## 1. Summary

A **window forward** is a binding, deliverable FX forward whose settlement may occur on
one or more business days inside a predefined date range ("the window") — but **any
remaining notional must settle by the final window date.** It is *not* an option: there
is no walk-away. The notional and rate are locked at trade time; the corporate draws
against the contract — potentially in multiple partial draws — on dates of their choosing
inside the window, and the bank settles any undrawn residual at the window's end.

For the fixed-rate (time-option) variant this spec targets for v1, the bank quotes the
**worst forward rate across the window** as the single contracted rate (it must assume the
corporate settles on the least-favorable date). Some providers also offer pro-rata /
date-adjusted pricing, where each draw is priced to its own date; we accommodate that as
a future variant via an explicit `pricing_method` discriminator (see §3.1, §4).

Product references: CFTC interpretation of window forwards as binding deliverable
forwards (window settlement, mandatory final settlement); Convera "open/window forward"
PDS; KASIKORNBANK time-option / pro-rata forward descriptions.

Window forwards are the physical-settlement, flexible-date cousin of the outright
forward. Fortune-500 treasury teams use them heavily for cash flows with uncertain
timing: supplier payables (net-30 ± a few days), payroll cycles, customer collections,
M&A escrow releases, and capex draw schedules.

This spec makes window forwards a primary instrument choice throughout Quova: data
model, policy controls, hedge entry, draw recording, **draw-to-exposure allocation**,
**mandatory end-of-window settlement**, advisor recommendations (a new Strategy D),
coverage analytics, indicative MTM, board reporting, lifecycle (roll/amend/close),
onboarding capture, tier gating, audit, and
tests.

---

## 2. Decisions (locked during brainstorming + expert review)

| Decision | Choice |
|---|---|
| **Product class** | Binding, deliverable forward with windowed + **mandatory final** settlement (not an option) |
| **Pricing method (v1)** | `fixed_worst_rate` only; `pricing_method` enum reserves `pro_rata_points` for a later variant |
| **Draw rate authority** | **Server sets `draw_rate` from `hedge_positions.contracted_rate`** for `fixed_worst_rate`; client never supplies it |
| **Settlement model** | Multiple partial draws across the window; **residual force-settles at window end** |
| **Draw economics (treasury, not accounting)** | Each draw records `spot_rate_at_draw`, `realized_pnl_quote`, `realized_pnl_usd`, settlement amount, bank-confirmation fields — **stored, never recomputed from mutable spot**. This is **Economic P&L** for treasury analytics only — *not* an accounting recognition event |
| **Exposure linkage** | Each draw **allocates against `fx_exposures` / derived source rows** so coverage and exposure move together |
| **Policy controls** | Full: instrument allowlist + eligible pairs + max window length + max draws per window |
| **Policy UI home** | **`StrategyPage.tsx`** (existing policy workbench) — *not* Settings |
| **Advisor surfacing** | New **Strategy D — Flex-Timing Hedge** (`Strategy.id` extended to include `'D'`) |
| **Tier gating** | Pro / Enterprise only (Exposure tier sees it locked) |
| **Hedge accounting** | **Out of scope for this spec.** Window forwards plug into the *existing* CFH/FVH/undesignated MTM→AOCI export machinery for the undrawn residual (indicative). Full designation, AOCI allocation, reclassification, probability/failure, dedesignation, and the ASC 815 ↔ IFRS 9 split are a separate cross-cutting spec: `2026-06-04-hedge-accounting-redesign-design.md` |
| **MTM status** | **Indicative** (interest-rate-differential curve), clearly labeled; **bank MTM is the accounting source of truth** (ASC 820 exit price) |
| **Data model** | Approach 1 — discriminated subtype on `hedge_positions` + `hedge_position_draws` + `draw_exposure_allocations` |
| **Residual MTM mark** | Mark undrawn notional to the **window-end date** (conservative, matches bank convention) |
| **Coverage treatment** | Effective notional = `notional_base − drawn_notional`; centralized in one helper used by view + client |

---

## 3. Data Layer

### 3.1 Schema — Migration A: extend `hedge_positions`

```sql
ALTER TABLE hedge_positions
  DROP CONSTRAINT IF EXISTS hedge_positions_instrument_type_check,
  ADD  CONSTRAINT hedge_positions_instrument_type_check
       CHECK (instrument_type IN ('forward', 'window_forward', 'swap', 'option', 'spot')),
  ADD  COLUMN IF NOT EXISTS window_start_date DATE,
  ADD  COLUMN IF NOT EXISTS window_end_date   DATE,
  ADD  COLUMN IF NOT EXISTS pricing_method    TEXT,   -- 'fixed_worst_rate' (v1) | 'pro_rata_points' (future)
  ADD  COLUMN IF NOT EXISTS drawn_notional    NUMERIC(20,2) NOT NULL DEFAULT 0;

-- Window-forward field consistency
ALTER TABLE hedge_positions
  ADD CONSTRAINT window_dates_consistent CHECK (
    (instrument_type = 'window_forward'
       AND window_start_date IS NOT NULL
       AND window_end_date   IS NOT NULL
       AND window_end_date >= window_start_date
       AND pricing_method  IN ('fixed_worst_rate','pro_rata_points'))
    OR (instrument_type <> 'window_forward'
       AND window_start_date IS NULL
       AND window_end_date   IS NULL
       AND pricing_method    IS NULL)
  ),
  ADD CONSTRAINT drawn_notional_bounded
      CHECK (drawn_notional >= 0 AND drawn_notional <= notional_base);
```

Conventions:
- `value_date` reused as window end date; `window_end_date` stored too for query clarity.
- `contracted_rate` holds the locked **worst-rate-in-window** quote (v1 `fixed_worst_rate`).
- `pricing_method` is the variant discriminator; v1 only writes `fixed_worst_rate`.
- `drawn_notional` is trigger-maintained (§3.3), never client-written.
- Migration is **idempotent** (`IF NOT EXISTS`, `IF EXISTS`) — coexists with the v2 policy
  migration already in the repo (`20260330_hedge_policy_v2.sql`).

### 3.2 Status model — partial vs final

`hedge_positions.status` already permits `active | expired | cancelled | rolled | closed`
(via `20260411_hedge_lifecycle.sql`). Window forwards use:

- `active` — open, `drawn_notional` may be 0 or partial.
- `closed` — fully settled, either by reaching `notional_base` in draws **or** by
  final-window settlement of the residual (§3.6).

No new status value is required; "partially drawn" is expressed by
`0 < drawn_notional < notional_base AND status='active'`.

### 3.3 Schema — Migration B: `hedge_position_draws` (+ economics) + recalc trigger

```sql
CREATE TABLE hedge_position_draws (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  position_id        UUID NOT NULL REFERENCES hedge_positions(id) ON DELETE CASCADE,
  draw_seq           INTEGER NOT NULL,               -- 1..n within a position
  draw_date          DATE NOT NULL,
  draw_amount        NUMERIC(20,2) NOT NULL CHECK (draw_amount > 0),
  draw_rate          NUMERIC(20,8) NOT NULL,         -- server-set from contracted_rate (v1)
  spot_rate_at_draw  NUMERIC(20,8) NOT NULL,         -- recorded at draw time, immutable
  settlement_quote   NUMERIC(20,2) NOT NULL,         -- draw_amount × draw_rate, quote ccy
  realized_pnl_quote NUMERIC(20,2) NOT NULL,         -- (draw_rate − spot_at_draw)×amt, signed
  realized_pnl_usd   NUMERIC(20,2) NOT NULL,         -- USD-converted at draw time
  is_final_settlement BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE for forced end-of-window residual
  bank_confirmation  TEXT,                           -- bank deal/confirmation ref
  reference_number   TEXT,
  notes              TEXT,
  created_by         UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT draw_org_matches_position CHECK (true)  -- enforced by trigger (§3.5), see note
);

CREATE UNIQUE INDEX uq_draw_seq        ON hedge_position_draws(position_id, draw_seq);
CREATE INDEX        idx_draws_position  ON hedge_position_draws(position_id);
CREATE INDEX        idx_draws_org_date  ON hedge_position_draws(org_id, draw_date);
```

> **These are ECONOMIC P&L facts for treasury analytics — not accounting recognition.**
> `spot_rate_at_draw`, `realized_pnl_quote`, `realized_pnl_usd`, and `settlement_quote`
> are recorded at draw time and never recomputed from later (mutable) spot data. They
> drive the blotter, board analytics, and the draw ledger. They do **not** by themselves
> produce journal entries. For a designated cash flow hedge, the derivative's gain/loss
> sits in AOCI and reclassifies to earnings only when the hedged forecast transaction
> affects earnings — which is the job of the separate hedge-accounting-redesign spec, not
> this one. This spec emits **no** draw-level accounting journal entries.

Recalc + auto-close trigger:

```sql
CREATE OR REPLACE FUNCTION recalc_drawn_notional()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC(20,2); v_notional NUMERIC(20,2); v_pos UUID;
BEGIN
  v_pos := COALESCE(NEW.position_id, OLD.position_id);
  -- Lock the parent row so concurrent draws serialize on it.
  SELECT notional_base INTO v_notional FROM hedge_positions WHERE id = v_pos FOR UPDATE;
  SELECT COALESCE(SUM(draw_amount),0) INTO v_total
    FROM hedge_position_draws WHERE position_id = v_pos;
  UPDATE hedge_positions
    SET drawn_notional = v_total,
        status = CASE WHEN v_total >= v_notional THEN 'closed' ELSE status END,
        updated_at = NOW()
    WHERE id = v_pos;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_draws_recalc_notional
  AFTER INSERT OR UPDATE OR DELETE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION recalc_drawn_notional();
```

Apply the session-14 mandatory audit trigger (`trg_audit_hedge_position_draws`) for SOC2
coverage.

### 3.4 Schema — Migration C: `draw_exposure_allocations` (exposure linkage)

A draw settles a slice of an underlying exposure. Without recording that link, coverage
can fall (because the window forward is drawn) while the exposure stays open — a false
"now under-hedged" signal. This table ties draws to the exposures they settle.

```sql
CREATE TABLE draw_exposure_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  draw_id         UUID NOT NULL REFERENCES hedge_position_draws(id) ON DELETE CASCADE,
  -- Exactly one of the two targets is set:
  exposure_id     UUID REFERENCES fx_exposures(id) ON DELETE SET NULL,
  derived_source  TEXT,        -- e.g. 'supplier_contract' (derived exposures have no PK row)
  derived_ref     TEXT,        -- upload-table row id when derived_source is set
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_target CHECK (
    (exposure_id IS NOT NULL AND derived_source IS NULL)
    OR (exposure_id IS NULL AND derived_source IS NOT NULL)
  )
);

CREATE INDEX idx_alloc_draw     ON draw_exposure_allocations(draw_id);
CREATE INDEX idx_alloc_exposure ON draw_exposure_allocations(exposure_id);
```

Behavior:
- When a draw allocates to a DB `fx_exposures` row, the settled portion of that exposure
  is marked settled (a `settled_amount` column added to `fx_exposures`, or a status flip
  when fully allocated) so net exposure and net hedged fall **together**.
- For derived exposures (CSV-sourced, no stable PK), the allocation records
  `derived_source` + `derived_ref`; the coverage layer nets these out of the derived
  exposure total.
- Allocation is **optional at draw time but strongly surfaced** in the draw UI (§4.2):
  the modal pre-suggests the exposures in the same pair maturing inside the window.
  Unallocated draws still settle, but the UI flags "draw not linked to an exposure."

### 3.5 Server-side invariants & RPCs

Table-level + RPC-level hardening (defense in depth):

- **Org match:** `draw.org_id` must equal `position.org_id`. Enforced by a
  `BEFORE INSERT` trigger that reads the parent position's `org_id` and rejects
  mismatch (the `CHECK` placeholder in §3.3 is realized here, since a CHECK can't
  subquery).
- **Parent lock:** draw insert path takes `SELECT ... FOR UPDATE` on the parent
  position (already in the recalc trigger) so max-draw-count and notional invariants
  hold under concurrency.
- **Draw-rate authority:** for `fixed_worst_rate`, the `record_window_draw()` RPC sets
  `draw_rate := position.contracted_rate`; client-supplied rates are ignored.
- **Economics computed server-side:** `spot_rate_at_draw` pulled from the rate source at
  draw time; `realized_pnl_quote`, `realized_pnl_usd`, `settlement_quote` computed in the
  RPC with correct buy/sell sign and USD conversion, then stored.
- **Policy enforcement:** `validate_window_forward()` (SECURITY DEFINER, locked
  `search_path`) checks pair ∈ `window_forward_pairs`, window span ≤ `max_window_days`,
  draw count ≤ `max_draws_per_window`, Σ draws ≤ `notional_base`, draw_date within window
  **and on a business day** (window/holiday calendar).
- **Caller checks:** `book_hedge_position()` and `record_window_draw()` explicitly verify
  caller `org_id` (from `current_user_org_id()`, AAL2), role ∈ {admin, editor}, and tier
  allows `window_forwards`. Direct table writes that bypass policy are blocked by RLS
  `WITH CHECK` so the RPC is the only write path for window-forward bookings and draws.

### 3.6 Mandatory end-of-window settlement

When `window_end_date` passes with `drawn_notional < notional_base`, the residual cannot
remain `active`. A scheduled job force-settles it:

- **Job:** a `settle-expired-windows` routine (pg_cron calling an RPC, or an Edge Function
  on a daily cron — match whatever scheduled-job pattern this repo already uses for digest
  emails). Runs daily.
- **Action:** for each window forward where `window_end_date < today AND status='active'`,
  insert a final draw (`is_final_settlement = TRUE`) for the remaining notional at
  `contracted_rate`, recording spot/realized-P&L economics exactly like a manual draw.
  The recalc trigger then flips status to `closed`.
- **Alerts:** fire a persistent alert (existing alerts system) at **T-7 and T-2 days**
  ("Window forward {pair} {ref} has ${residual} undrawn; settles {date}") and on final
  settlement ("Window forward {ref} auto-settled ${residual} at window end").
- **Manual closeout path:** the draw UI also offers "Settle remaining now" before expiry,
  which performs the same final-draw insert on demand.

### 3.7 Schema — Migration D: extend `hedge_policies` (idempotent)

`allowed_instruments TEXT[]` **already exists** (nullable) from
`20260330_hedge_policy_v2.sql`. Only add what's missing, and backfill carefully:

```sql
ALTER TABLE hedge_policies
  ADD COLUMN IF NOT EXISTS window_forward_pairs TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS max_window_days      INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS max_draws_per_window INTEGER NOT NULL DEFAULT 8;

DO $$ BEGIN
  ALTER TABLE hedge_policies ADD CONSTRAINT chk_hp_max_window_days
    CHECK (max_window_days > 0 AND max_window_days <= 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE hedge_policies ADD CONSTRAINT chk_hp_max_draws
    CHECK (max_draws_per_window > 0 AND max_draws_per_window <= 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: existing rows have NULL allowed_instruments → treat as "all classic four",
-- and deliberately DO NOT enable window_forward on backfill (explicit opt-in only).
UPDATE hedge_policies
  SET allowed_instruments = ARRAY['forward','swap','option','spot']::TEXT[]
  WHERE allowed_instruments IS NULL;
```

- `window_forward` is opt-in: it is **never** added to `allowed_instruments` by migration.
- `window_forward_pairs` empty by default — admin must list eligible pairs.
- **Add `hedge_policies` to the session-14 mandatory audit trigger** in this migration
  (`trg_audit_hedge_policies`). The new allowlist/eligible-pair controls govern what
  traders may book, so policy changes must be audit-logged. `hedge_policies` is *not*
  currently among the seven audited tables; orbit-mvp has no separate `policy_versions`
  table, so the mandatory audit trigger is the version history.

### 3.8 Tier gating

`src/lib/tierService.ts`:

```ts
window_forwards: { exposure: false, pro: true, enterprise: true }
```

- Exposure tier: shown in the instrument list but disabled (lock icon + UpgradeModal).
- Pro/Enterprise: enabled, subject to policy controls.
- Mirrors the existing `email_notifications` gating pattern.

---

## 4. Policy & Advisor

### 4.1 Policy UI — extend the existing workbench in `StrategyPage.tsx`

The policy controls already live in `StrategyPage.tsx` (the `INSTRUMENTS` const at line 23
and the "Allowed Instruments" toggle group at ~line 638), **not** in Settings. Do not
create a second policy home. Changes there:

- Add `'window_forward'` to the `INSTRUMENTS` const and `INSTRUMENT_LABELS`
  ("Window Forwards"), with a "Pro" badge on Exposure tier (UpgradeModal on click).
- When Window Forwards is toggled on, reveal a sub-panel (same card styling as the rest
  of the workbench):
  - Eligible currency pairs (multi-select from configured pairs) → `window_forward_pairs`
  - Max window length (days), default 90, max 365 → `max_window_days`
  - Max partial draws per window, default 8, max 50 → `max_draws_per_window`
- Persist via the existing policy save path; changes audit-logged by
  `trg_audit_hedge_policies` (§3.7).

### 4.2 Hedge entry & draw UX

**Entry form (`HedgePage.tsx`):** add `window_forward` to `INSTRUMENT_TYPES` (line 79).
When selected, swap the single value-date picker for window start/end pickers, show a
live "span / max-draws" policy readout, and render a **read-only "Worst rate in window"**
preview (min of the forward curve across the window for a sell, max for a buy; extrapolate
beyond 12 months with a footnote). The contracted rate is the worst-rate quote; the client
does not type a rate. Review step shows a "Window Forward" badge + summary.

**Record-a-draw flow (`TradePage` blotter):** new "Record draw" action on active window
forwards. Two-step modal (form → review):
- Form: draw date (default today, must be a business day in the window), draw amount
  (≤ remaining notional), bank confirmation / reference, notes.
- **Exposure allocation:** the modal lists exposures in the same pair maturing inside the
  window and lets the user allocate this draw against one or more (§3.4). Pre-suggested,
  not mandatory; an unallocated draw is flagged.
- Review: amount drawn, remaining notional after draw, days left, **server-previewed
  realized P&L** (the RPC returns the computed economics; UI does not invent them).
- "Settle remaining now" closeout option (§3.6).

Position detail panel: window timeline bar (start/today/end), draws ledger
(seq / date / amount / draw-rate / spot-at-draw / realized P&L / final-flag / bank ref),
"Remaining · Days left · Avg draw rate" tiles, T-7 amber / T-2 red countdown.

### 4.3 Advisor — Strategy D (Flex-Timing Hedge)

- **Type change:** extend `Strategy.id` from `'A' | 'B' | 'C'` to include `'D'`
  (`advisorEngine.ts:64`) and thread `'D'` through the advisor UI's per-strategy rendering.
- **Timing-uncertainty signal — use the correct (singular) source names** from
  `useDerivedExposures.ts`:

```ts
// DerivedExposureSource values are SINGULAR in this repo.
const TIMING_UNCERTAIN_SOURCES = ['payroll', 'cash_flow', 'supplier_contract', 'customer_contract'] as const

function timingUncertaintyShare(exposures, derivedExposures): number {
  const totalUsd     = sumUsd(exposures, derivedExposures)
  const uncertainUsd = sumUsd(derivedExposures.filter(e => TIMING_UNCERTAIN_SOURCES.includes(e.source)))
  return totalUsd > 0 ? uncertainUsd / totalUsd : 0
}
```

- **Scoring (parallels existing `policyScore`):**

```ts
const D_target = clamp(0.85, policy.min_coverage_pct, policy.max_coverage_pct)  // 85% default
const D_tenor  = Math.min(estimatedTenorMonths, 9)                              // ≤9 months
const D_score  = policyScore(D_target, D_tenor, ['window_forward'])
               + 25 * timingUncertaintyShare       // up to +25 when fully timing-uncertain
               - 10 * (1 - timingUncertaintyShare)  // up to −10 when fully timing-certain
```

- D outranks A when the exposure base is heavy in payroll/supplier/customer-contract
  categories; underranks A for one-off PO exposures.
- **Policy gating:** Strategy D is surfaced only when `policy.allowed_instruments`
  includes `'window_forward'`; otherwise the card is hidden (not greyed).
- Card content: 90% target coverage, "window forwards across 60-day rolling windows",
  backtest panel using simulated worst-rate-in-window pricing, and a Claude-generated
  narrative explaining D's rank given the org's exposure profile.

### 4.4 Onboarding capture (`SetupWizard.tsx`)

New optional accordion "Hedging Instruments Currently Used" (checkboxes: outright
forwards / window forwards / FX swaps / options / spot / none). Stored in
`organization_profiles.instruments_used TEXT[]` (new column). Seeds
`hedge_policies.allowed_instruments` default at policy creation (Pro/Enterprise only;
Exposure tier leaves `window_forward` off regardless). Advisor narrative references it.

---

## 5. Valuation & Coverage

### 5.1 Centralized "effective notional"

Coverage math currently lives in **three** places that must agree: the DB view
`v_hedge_coverage` (`001_initial_schema.sql:152`) and two client blocks in
`useCombinedCoverage.ts` (lines ~48 and ~180). Adding window forwards must not deepen
that divergence.

- **Single rule:** a position's effective hedged notional is
  `instrument_type = 'window_forward' ? (notional_base − drawn_notional) : notional_base`.
- **Client:** extract a `effectiveHedgedNotional(position)` helper (new, in
  `src/lib/windowForward.ts`) and call it from **both** `useCombinedCoverage` blocks,
  replacing the raw `notional_base` reads in the `|sell − buy|` sums.
- **DB view:** apply the same CASE expression inside the view's
  `SUM(CASE WHEN direction = 'sell' …)` aggregate.
- A vitest parity test asserts the client helper and a fixture mirroring the view agree.

Coverage drops as a window forward is drawn **in lockstep with the underlying exposure
falling** via the draw-exposure allocations (§3.4) — so net exposure and net hedged move
together, and coverage % stays meaningful rather than artificially collapsing.

### 5.2 MTM — two components (indicative)

New pure-TS module `src/lib/windowForward.ts`, `windowForwardMtm(position, draws, fxRates)`.

- **(A) Drawn notional:** settled; realized P&L is the **stored** `realized_pnl_usd` per
  draw, not recomputed. Excluded from floating MTM.
- **(B) Undrawn notional:** floats against `contracted_rate`, marked to the window-end
  forward (conservative):

```ts
const remaining   = notional_base - drawn_notional
const currentFwd  = forwardRateToWindowEnd(pair, window_end_date, fxRates)  // indicative
const rawMtm = direction === 'sell'
  ? (contracted_rate - currentFwd) * remaining
  : (currentFwd - contracted_rate) * remaining
const quoteCcy = pair.split('/')[1] ?? 'USD'
const mtmUsd   = toUsd(Math.abs(rawMtm), quoteCcy, fxRates) * (rawMtm >= 0 ? 1 : -1)
```

> **MTM is labeled indicative** everywhere it surfaces (built from the
> interest-rate-differential `buildForwardCurve()` approximation). Bank-provided MTM, when
> available, is authoritative. This framing is also applied to the existing MTM surfaces
> to keep the labeling honest.

Call sites branch on `instrument_type === 'window_forward'` → helper; all else keeps
existing inline math (`TradePage`, `HedgePage` tiles, `BoardReportPanel`, `AnalyticsPage`).

### 5.3 Hedge effectiveness — deferred to the hedge-accounting-redesign spec

**Hedge effectiveness for window forwards is NOT in this spec.** A correct measurement
requires the actual-derivative-versus-hypothetical-derivative apparatus with consistent
current market inputs, a chosen designation method (spot vs all-in forward), excluded
components, discounting/materiality policy, and — critically — the ASC 815 dollar-offset/
regression approach kept *separate* from the IFRS 9 qualitative model (which has no
80–125% bright line). That apparatus is instrument-agnostic and belongs in the dedicated
spec `2026-06-04-hedge-accounting-redesign-design.md`, which redesigns designation, AOCI
allocation, reclassification, probability/failure, and dedesignation for **all**
instruments, window forwards included.

> The earlier draft of this section contained a per-draw "dollar-offset ⇒ ASC 815 pass"
> formula whose residual leg (`contracted_rate − spot_at_trade`) was internally
> inconsistent with the §5.2 MTM residual (`contracted_rate − currentFwd`) and conflated
> accounting effectiveness with an economic-offset heuristic. It is removed. Do not
> reintroduce an effectiveness formula here; the accounting spec owns it.

What this spec *may* surface for treasury (clearly labeled **economic, not accounting**):
an optional **economic-offset indicator** = how closely the window forward's indicative
MTM offsets the marked change in the linked exposure. This is a treasury-analytics signal,
not an ASC 815 / IFRS 9 effectiveness assessment, and produces no journal entries.

---

## 6. Reporting, Lifecycle, Audit

### 6.1 Hedge accounting export (`HedgeAccountingExport.tsx`) — minimal, indicative

The existing export already routes cash-flow-hedge MTM to AOCI (Dr Derivative Asset /
Cr AOCI) and fair-value-hedge MTM to earnings, keyed off `hedge_position.hedge_type`. For
this spec, window forwards do exactly two things in the existing export — **no new
accounting logic**:

1. **The undrawn residual** is fed to the existing CFH/FVH/undesignated MTM machinery via
   `computeFairValue()`, which for a window forward calls `windowForwardMtm()` (§5.2,
   indicative). It produces the same kind of MTM→AOCI (CFH) or MTM→earnings (FVH) entry
   the export already generates for vanilla forwards — clearly labeled **indicative**.
2. **An informational "Window Forward Draws" XLSX sheet** lists the economic draw ledger
   (seq, date, pair, amount, draw-rate, spot-at-draw, realized economic P&L, final-flag,
   bank ref). This sheet is **treasury analytics, explicitly marked "not journal
   entries."**

**This spec does NOT emit:** per-draw settlement journal entries, AOCI
allocation/reclassification across forecast transactions, dedesignation events, or any
ASC 815 / IFRS 9 effectiveness verdict. All of that — the correct accounting recognition
that reclassifies AOCI to earnings only when the hedged forecast transaction affects
earnings — is owned by the separate **`2026-06-04-hedge-accounting-redesign-design.md`**
spec, which reworks designation, AOCI, reclassification, probability/failure, and
dedesignation for every instrument. Until that ships, the export's window-forward output
is indicative/preparatory and says so on its face.

### 6.2 Board reporting

- Window forward becomes a distinct slice in the instrument-mix composition.
- Coverage tables inherit the centralized effective-notional rule (§5.1).
- Narrative line when present: *"$X.XM hedged via window forwards across N active windows;
  $Y.YM drawn to date."*

### 6.3 Lifecycle (Roll / Amend / Close)

- **Roll:** rolls the undrawn residual into a new window; old → `rolled`; residual notional
  carries to the new linked position; drawn slices stay settled.
- **Amend:** window dates / notional amendable only while `drawn_notional = 0` (can't
  shrink below drawn; can't move start past an existing draw). Server-validated.
- **Close (early):** the §3.6 "settle remaining now" path — settles residual at
  `contracted_rate`, records final economics, status → `closed`.

> **Accounting events (flag only, in this spec).** Roll/amend/close that change critical
> terms (notional, rate, window, counterparty) can require **dedesignation and a new hedge
> relationship** under ASC 815 / IFRS 9. This spec emits the **economic** position change
> *and* a structured "critical-term-change" marker on the audit record; it does **not**
> perform the dedesignation/redesignation accounting itself. Consuming those markers to
> drive dedesignation, AOCI treatment of the discontinued relationship, and a fresh
> designation is the job of the hedge-accounting-redesign spec.

### 6.4 Audit & security

- `hedge_position_draws`, `draw_exposure_allocations`, and `hedge_policies` all get the
  session-14 mandatory audit trigger.
- RLS on the new tables mirrors `hedge_positions` (`current_user_org_id()`, AAL2);
  writes restricted to admin/editor via the RPCs; viewers read-only; direct
  policy-bypassing writes blocked by `WITH CHECK`.
- `record_window_draw()`, `book_hedge_position()`, `settle_expired_windows()` are
  `SECURITY DEFINER`, locked `search_path`, and check caller org + role + tier (§3.5).

> **Note:** orbit-mvp has no server-side four-eyes approval gate
> (`assert_approval_for_action`) and no bank-co-branded board reports — those belong to a
> separate platform. A four-eyes approval workflow is out of scope here; window-forward
> writes use the same RLS + role gating as every other hedge action in this repo.

---

## 7. Types & Testing

- TypeScript discriminated union in `src/types/index.ts`:
  `HedgePosition = OutrightForward | WindowForward | Swap | Option | Spot`, where
  `WindowForward` carries non-null `window_start_date`, `window_end_date`,
  `pricing_method`, `drawn_notional`, `draws: HedgeDraw[]`, and (hydrated) allocations.
- Extend `Strategy.id` to `'A' | 'B' | 'C' | 'D'`.
- Regenerate `database.types.ts` (`npm run types:db`) after migrations.
- New hooks: `useWindowDraws(positionId)` (CRUD incl. allocations); `useHedgePositions`
  hydrates draws + allocations for window positions.
- vitest `windowForward.test.ts` (~25 cases, **economic only — no accounting/effectiveness
  assertions**):
  - Effective-notional helper parity with the view fixture
  - Fully-undrawn window MTM == vanilla forward MTM (parity)
  - Fully-drawn window MTM == 0 floating (uses stored realized economic P&L)
  - Partial draw reduces floating MTM proportionally; USD conversion correct for CCY/USD
    and cross pairs
  - Coverage + exposure fall **together** when a draw allocates to an exposure
  - Economic realized P&L sign correct for buy and sell draws
  - Final-settlement draw forced at window end; status → closed
  - Draw exceeding remaining notional rejected; draw outside window rejected; draw on a
    non-business day rejected
  - Strategy D scoring favors timing-uncertain exposure base; underranks certain; hidden
    when policy disallows window_forward
- Security regression (`tests/security/*.test.mjs`): viewer cannot insert draws; draw
  cannot exceed `max_draws_per_window`; cross-org draw rejected; client-supplied draw_rate
  ignored (server overrides from contracted_rate).

---

## 8. Documentation

- New `CLAUDE.md` session entry: the feature, `windowForward.ts`, the two new tables, the
  centralized effective-notional rule, end-of-window settlement job, and the indicative-MTM
  framing.
- Inline JSDoc on `windowForward.ts` exports.

---

## 9. Implementation sequence (build order)

Per expert recommendation, build the financial model **before** wiring it into the UI:

1. **Phase 1 — Schema & RPC invariants.** Migrations A–D (idempotent), the org-match /
   parent-lock / draw-rate-authority / policy-validation triggers and RPCs, audit-trigger
   extensions, RLS. No UI. Security regression tests land here.
2. **Phase 2 — Booking & draw lifecycle.** `book_hedge_position()` window path,
   `record_window_draw()` with server-computed economics, `settle_expired_windows()` job,
   end-of-window alerts. Hooks (`useWindowDraws`). Unit tests for economics + final
   settlement.
3. **Phase 3 — Coverage & exposure allocation.** `draw_exposure_allocations`, centralized
   `effectiveHedgedNotional`, view update, both `useCombinedCoverage` blocks, parity test.
4. **Phase 4 — Indicative valuation & reporting.** `windowForward.ts` MTM (indicative
   labeling), the minimal hedge-accounting export plug-in (§6.1 — undrawn residual through
   existing CFH/FVH machinery + informational draws sheet), board reporting. **No
   effectiveness engine, no per-draw JEs** — those are the accounting-redesign spec.
5. **Phase 5 — Advisor & entry/policy UI.** Strategy D (type + scoring + card), StrategyPage
   policy controls, HedgePage entry form, TradePage draw + allocation modal, onboarding
   capture.

Each phase is independently testable and reviewable. **Hedge accounting (designation,
AOCI allocation, reclassification, probability/failure, dedesignation, ASC 815 ↔ IFRS 9)
is a separate project** — see `2026-06-04-hedge-accounting-redesign-design.md` — and is a
prerequisite before any window-forward output may be called auditor-ready.

---

## 10. Surface count

~24 files across 6 layers: 4 migrations + audit-trigger extension, 1 new pure-TS module
(`windowForward.ts` — indicative MTM + effective-notional helper), 2 new hooks, 2 new
tables (`hedge_position_draws`, `draw_exposure_allocations`), entry form, blotter draw +
allocation modal, advisor engine + Strategy D, **StrategyPage** policy controls, onboarding
capture, MTM at 4 call sites, coverage view + 2 client blocks (via one helper), the
**minimal** hedge-accounting export plug-in (§6.1), board reporting, lifecycle guards
(+ critical-term-change markers), end-of-window settlement job, types, and tests. **No
effectiveness engine and no accounting recognition logic** — those live in the separate
hedge-accounting-redesign spec.

---

## 11. Out of scope (explicitly deferred)

- **The entire hedge-accounting subsystem** — designation records, AOCI allocation across
  forecast transactions, reclassification when the hedged item affects earnings,
  probability/failure handling, dedesignation/redesignation, and the separate ASC 815 vs
  IFRS 9 effectiveness methods. Covered by **`2026-06-04-hedge-accounting-redesign-design.md`**
  (its own spec → plan → build cycle), which applies to **all** instruments, not just
  window forwards. This window-forward spec emits no journal entries and no effectiveness
  verdicts.
- `pro_rata_points` pricing variant (schema reserves `pricing_method`; v1 ships
  `fixed_worst_rate` only).
- Real forward-curve market-data feed (v1 uses `buildForwardCurve()` IR-differential
  approximation; MTM labeled indicative).
- Probability-weighted expected-draw-date MTM (v1 marks residual to window end).
- Window forwards on the commodity-risk module (FX only for v1).
- Authoritative bank MTM ingestion (when added, supersedes the indicative figure and
  becomes the accounting source of truth).
