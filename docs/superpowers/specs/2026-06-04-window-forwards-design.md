# Window Forwards — Design Spec

> **Status:** Approved (design phase)
> **Date:** 2026-06-04
> **Author:** Steve LaBella + Claude (brainstorming session)
> **Feature:** Add window forwards as a first-class hedging instrument across Quova,
> alongside outright forwards, FX swaps, options, and spot.

---

## 1. Summary

A **window forward** is an FX forward whose settlement date is any business day inside
a date range ("the window") rather than a single fixed day. The notional and rate are
locked at trade time; the corporate draws against the contract — potentially in multiple
partial draws — on dates of their choosing inside the window. The bank quotes the
**worst forward rate across the window** as the contracted rate (it must assume the
corporate settles on the least-favorable date).

Window forwards are the physical-settlement, flexible-date cousin of the outright
forward. Fortune-500 treasury teams use them heavily for cash flows with uncertain
timing: supplier payables (net-30 ± a few days), payroll cycles, customer collections,
M&A escrow releases, and capex draw schedules.

This spec makes window forwards a primary instrument choice throughout Quova: data
model, policy controls, hedge entry, draw recording, advisor recommendations (a new
Strategy D), coverage analytics, MTM, hedge-effectiveness testing, hedge-accounting
export, board reporting, lifecycle (roll/amend/close), onboarding capture, tier gating,
audit, and tests.

---

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| **Settlement model** | Multiple partial draws across the window (not single-draw) |
| **Policy controls** | Full: instrument allowlist + eligible pairs + max window length + max draws per window |
| **Advisor surfacing** | New **Strategy D — Flex-Timing Hedge** |
| **Tier gating** | Pro / Enterprise only (Exposure tier sees it locked) |
| **Effectiveness model** | Window-aware (per-draw hypothetical-derivative re-runs) |
| **Data model** | Approach 1 — discriminated subtype on `hedge_positions` + new `hedge_position_draws` table |
| **Residual MTM mark** | Mark undrawn notional to the **window-end date** (conservative, matches bank convention) |
| **Coverage treatment** | Undrawn notional counts as coverage; drawn slices drop out |

---

## 3. Data Layer

### 3.1 Schema — Migration A: extend `hedge_positions`

```sql
ALTER TABLE hedge_positions
  DROP CONSTRAINT hedge_positions_instrument_type_check,
  ADD  CONSTRAINT hedge_positions_instrument_type_check
       CHECK (instrument_type IN ('forward', 'window_forward', 'swap', 'option', 'spot')),
  ADD  COLUMN window_start_date  DATE,
  ADD  COLUMN window_end_date    DATE,
  ADD  COLUMN drawn_notional     NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD  CONSTRAINT window_dates_consistent CHECK (
    (instrument_type = 'window_forward'
       AND window_start_date IS NOT NULL
       AND window_end_date   IS NOT NULL
       AND window_end_date >= window_start_date)
    OR (instrument_type <> 'window_forward'
       AND window_start_date IS NULL
       AND window_end_date   IS NULL)
  ),
  ADD  CONSTRAINT drawn_notional_bounded
       CHECK (drawn_notional >= 0 AND drawn_notional <= notional_base);
```

Conventions:
- `value_date` is reused as the window end date (store `window_end_date` too for query
  clarity at call sites).
- `contracted_rate` holds the bank's locked **worst-rate-in-window** quote.
- `drawn_notional` is maintained by trigger (see 3.2), never written by the client.

### 3.2 Schema — Migration B: `hedge_position_draws` + recalc trigger

```sql
CREATE TABLE hedge_position_draws (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  position_id      UUID NOT NULL REFERENCES hedge_positions(id) ON DELETE CASCADE,
  draw_date        DATE NOT NULL,
  draw_amount      NUMERIC(20,2) NOT NULL CHECK (draw_amount > 0),
  draw_rate        NUMERIC(20,8) NOT NULL,
  reference_number TEXT,
  notes            TEXT,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_position_draws_position ON hedge_position_draws(position_id);
CREATE INDEX idx_position_draws_org_date ON hedge_position_draws(org_id, draw_date);

-- Maintains hedge_positions.drawn_notional and auto-closes when fully drawn.
CREATE OR REPLACE FUNCTION recalc_drawn_notional()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC(20,2); v_notional NUMERIC(20,2); v_pos UUID;
BEGIN
  v_pos := COALESCE(NEW.position_id, OLD.position_id);
  SELECT COALESCE(SUM(draw_amount),0) INTO v_total
    FROM hedge_position_draws WHERE position_id = v_pos;
  SELECT notional_base INTO v_notional FROM hedge_positions WHERE id = v_pos;
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

Apply the session-14 mandatory audit trigger to `hedge_position_draws` for SOC2 coverage.

### 3.3 Schema — Migration C: extend `hedge_policies`

```sql
ALTER TABLE hedge_policies
  ADD COLUMN allowed_instruments  TEXT[] NOT NULL
      DEFAULT ARRAY['forward','swap','option','spot']::TEXT[],
  ADD COLUMN window_forward_pairs TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN max_window_days      INTEGER NOT NULL DEFAULT 90
      CHECK (max_window_days > 0 AND max_window_days <= 365),
  ADD COLUMN max_draws_per_window INTEGER NOT NULL DEFAULT 8
      CHECK (max_draws_per_window > 0 AND max_draws_per_window <= 50);
```

- `allowed_instruments` deliberately **omits `window_forward`** by default — explicit
  opt-in via Settings → Policy.
- `window_forward_pairs` empty by default — admin must list eligible pairs.
- `advisorEngine.ts` already references `policy.allowed_instruments` (defaults to all
  four today since the column didn't exist) — this column makes that real.

**Also add `hedge_policies` to the session-14 mandatory audit trigger** in this
migration. The new instrument-allowlist and eligible-pair controls are
compliance-sensitive (they govern what traders are permitted to book), so policy
changes must be audit-logged. `hedge_policies` is **not** currently among the seven
audited tables in `20260414_mandatory_audit_triggers.sql`; this migration adds the
`trg_audit_hedge_policies` trigger so allowlist edits produce before/after JSONB audit
rows. (Orbit-mvp has no separate `policy_versions` table — the mandatory audit trigger
is the version history.)

### 3.4 Server-side validation

```sql
CREATE OR REPLACE FUNCTION validate_window_forward(...)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- Enforces: pair ∈ window_forward_pairs; (window_end - window_start) <= max_window_days;
-- draw count <= max_draws_per_window; Σ draws <= notional_base; draw_date within window.
$$;
```

Called from `book_hedge_position()` and `record_window_draw()` RPCs (both
`SECURITY DEFINER`, locked `search_path`). Client cannot bypass policy limits.

### 3.5 Tier gating

`src/lib/tierService.ts`:

```ts
window_forwards: { exposure: false, pro: true, enterprise: true }
```

- Exposure tier: shown in dropdown but disabled (lock icon + UpgradeModal).
- Pro/Enterprise: enabled, subject to policy controls.
- Mirrors the existing `email_notifications` gating pattern.

### 3.6 Policy UI (Settings → Policy tab)

New "Allowed Instruments" section: five checkboxes (Forward / Window Forward / Swap /
Option / Spot). The Window Forward checkbox carries a "Pro" badge on Exposure tier.
When checked, reveals a sub-panel:
- Eligible currency pairs (multi-select from configured pairs)
- Max window length (days), default 90, max 365
- Max partial draws per window, default 8, max 50

Persisted via `hedge_policies` UPDATE; changes audit-logged via the new
`trg_audit_hedge_policies` trigger added in Migration C (§3.3).

---

## 4. User-Facing UX

### 4.1 Hedge entry form (`HedgePage.tsx`)

`INSTRUMENT_TYPES` (line 79) gains `{ value: 'window_forward', label: 'Window Forward',
badge: 'Flex Timing' }` — teal chip, locked on Exposure tier.

Entry step, conditional on `instrument_type === 'window_forward'`:

| Field | Window-only | Notes |
|---|---|---|
| Currency pair | — | Filtered to `window_forward_pairs` when window selected |
| Window start date | ✓ | Replaces single value-date picker |
| Window end date | ✓ | Span live-validated against `max_window_days` |
| Window span readout | ✓ | "60 days · 8 max draws allowed" — live policy display |
| Worst rate in window | ✓ | Read-only preview; min (sell) or max (buy) of forward curve across window; replaces `contracted_rate` input |

Worst-rate preview reads the existing `buildForwardCurve()` 12-month curve already in
`HedgePage`. For windows beyond 12 months, extrapolate using the same annualized premium
and show a "rate extrapolated" footnote.

Review step shows a "Window Forward" badge + one-line summary:
"Window: Oct 1 → Nov 30 · Up to 8 draws · Worst-rate quote 1.0985 EUR/USD."

### 4.2 Record-a-draw flow (`TradePage` blotter)

New row action **"Record draw"** on `instrument_type='window_forward'` +
`status='active'` positions (alongside Roll / Amend / Close).

Two-step modal (form → review):
- Form: draw date (default today, must be in window), draw amount (≤ remaining notional),
  reference number, notes.
- Server-validated: draw_date within window; amount ≤ remaining; total draws ≤
  `max_draws_per_window`.
- Review: amount drawn, remaining notional after draw, days remaining in window,
  estimated realized P&L at this draw rate.

DB trigger auto-closes when `drawn_notional` reaches `notional_base` ("Fully drawn"
badge).

**Position detail panel** (expand-row): window timeline bar (start/today/end markers);
draws ledger (date / amount / rate / reference / who / when); "Remaining · Days left ·
Avg draw rate" tiles; days-remaining countdown amber inside 7 days, red inside 2.

### 4.3 Advisor — Strategy D (Flex-Timing Hedge)

Tagline: *"Lock the rate, keep timing flexibility for variable cash flows."*
Badge: amber-teal gradient (distinct from A/B/C blues).

New scoring input — `timing_uncertainty_share` from derived exposures:

```ts
const TIMING_UNCERTAIN_SOURCES = ['payroll', 'cash_flows', 'supplier_contracts', 'customer_contracts']

function timingUncertaintyShare(exposures, derivedExposures): number {
  const totalUsd    = sumUsd(exposures, derivedExposures)
  const uncertainUsd = sumUsd(derivedExposures.filter(e => TIMING_UNCERTAIN_SOURCES.includes(e.source)))
  return totalUsd > 0 ? uncertainUsd / totalUsd : 0
}
```

Strategy D scoring (parallels existing `policyScore` shape):

```ts
const D_target = clamp(0.85, policy.min_coverage_pct, policy.max_coverage_pct)  // 85% default
const D_tenor  = Math.min(estimatedTenorMonths, 9)                              // ≤9 months
const D_score  = policyScore(D_target, D_tenor, ['window_forward'])
               + 25 * timingUncertaintyShare       // up to +25 when fully timing-uncertain
               - 10 * (1 - timingUncertaintyShare)  // up to −10 when fully timing-certain
```

D outranks A when exposure is heavy in payroll/supplier/customer-contract categories;
underranks A for one-off PO exposures.

Card: 90% target coverage, "window forwards across 60-day rolling windows", backtest
panel using simulated worst-rate-in-window pricing, and a Claude-generated narrative
explaining D's rank given the org's exposure profile.

**Policy gating:** Strategy D is surfaced only when `policy.allowed_instruments` includes
`'window_forward'`; otherwise the card is hidden (not greyed).

### 4.4 Onboarding capture (`SetupWizard.tsx`)

New optional accordion "Hedging Instruments Currently Used" between "Currency Exposure
Profile" and "Additional Details": checkboxes (Outright forwards / Window forwards / FX
swaps / Options / Spot / None–don't know yet). Stored in
`organization_profiles.instruments_used TEXT[]` (new column).

Populates `hedge_policies.allowed_instruments` default at policy creation (Pro/Enterprise
only; Exposure tier leaves `window_forward` off regardless). AI advisor narrative
references it.

---

## 5. Valuation & Coverage Math

### 5.1 MTM — two components

New pure-TS module `src/lib/windowForward.ts` (unit-testable in isolation, same pattern
as `hedgeEffectiveness.ts`). Exports `windowForwardMtm(position, draws, fxRates)`.

**(A) Drawn notional — settled, no floating MTM.** Realized P&L per draw =
`(draw_rate − spot_at_draw) × draw_amount`, direction-aware. Recorded, but excluded from
live MTM (consistent with how the blotter treats closed positions).

**(B) Undrawn notional — floats against contracted worst-rate:**

```ts
const remaining   = notional_base - drawn_notional
const contractRate = contracted_rate
const currentFwd  = forwardRateToWindowEnd(pair, window_end_date, fxRates)
const rawMtm = direction === 'sell'
  ? (contractRate - currentFwd) * remaining
  : (currentFwd - contractRate) * remaining
const quoteCcy = pair.split('/')[1] ?? 'USD'
const mtmUsd   = toUsd(Math.abs(rawMtm), quoteCcy, fxRates) * (rawMtm >= 0 ? 1 : -1)
```

The comparison forward is marked to the **window-end date** (latest possible residual
settlement) — conservative, matches bank valuation convention.

Call sites that branch on `instrument_type === 'window_forward'` → call the helper;
all else keeps existing inline math: `TradePage`, `HedgePage` tiles, `BoardReportPanel`,
`AnalyticsPage` `crBuildMtm`.

### 5.2 Coverage (`v_hedge_coverage`, `useCombinedCoverage`)

**Undrawn remaining notional counts as coverage; drawn slices drop out.** The view's
inner aggregate replaces `notional_base` with:

```sql
CASE WHEN instrument_type = 'window_forward'
     THEN (notional_base - drawn_notional)
     ELSE notional_base END
```

inside the existing direction-aware `SUM(...)`. Vanilla instruments unaffected
(`drawn_notional` defaults 0). `useCombinedCoverage` inherits via the view. Audit
implementation for any client-side direct `notional_base` sums and route through the
same effective-notional rule.

**Intended behavior:** coverage % visibly drops as a window forward is drawn down
(because the underlying exposure settles in parallel). This is treasury-correct.

### 5.3 Window-aware hedge effectiveness (`hedgeEffectiveness.ts`)

Per-draw plus residual:

```
For each draw i:
  hedged_item_i = (spot_at_draw_i − spot_at_trade) × draw_amount_i
  instrument_i  = (draw_rate_i    − spot_at_trade) × draw_amount_i
Residual (undrawn):
  hedged_item_r = (currentSpot  − spot_at_trade) × remaining
  instrument_r  = (contractRate − spot_at_trade) × remaining

Dollar-offset ratio = Σ instrument / Σ hedged_item   (80–125% for ASC 815 pass)
```

Each draw locks its own basis (forward points consumed at draw date differ from
inception) — the real source of ineffectiveness a window-aware model captures. New
result fields: `drawEvents[]`, `residualEffectiveness`, `blendedDollarOffset`. XLSX
export gains a per-draw effectiveness sub-table per designation + blended verdict;
methodology note updated.

---

## 6. Reporting, Audit, Lifecycle

### 6.1 Hedge accounting export (`HedgeAccountingExport.tsx`)

- Per-draw settlement journal entries (realized P&L) dated at each draw, alongside the
  standing MTM JE for the residual.
- Per-draw effectiveness sub-table (from 5.3) + blended dollar-offset verdict.
- Methodology note describing the per-draw hypothetical-derivative method and window-end
  residual valuation.
- New XLSX sheet "Window Forward Draws" (date, pair, amount, rate, realized P&L,
  reference) for the audit trail.

### 6.2 Board reporting (`BoardReportPanel`, `boardReportPdf`, `boardReportPptx`)

- Window forward becomes a distinct slice in the instrument-mix composition.
- Coverage tables inherit the effective-notional rule automatically.
- New narrative line when present: *"$X.XM hedged via window forwards providing
  settlement flexibility across N active windows; $Y.YM drawn to date."*

### 6.3 Lifecycle (Roll / Amend / Close)

- **Roll:** rolls the *undrawn residual* into a new window; old → `status='rolled'`,
  residual notional carries to the new linked position; drawn slices stay settled.
- **Amend:** window dates and notional amendable only while `drawn_notional = 0`
  (can't shrink notional below drawn; can't move start past an existing draw).
  Server-validated.
- **Close (early):** settles remaining notional at the close rate, records final realized
  P&L, `status='closed'`.

### 6.4 Audit & security

- `hedge_position_draws`: session-14 mandatory audit trigger (before/after JSONB).
- RLS mirroring `hedge_positions` (`current_user_org_id()` with AAL2); insert restricted
  to admin/editor; viewers read-only.
- `record_window_draw()` and `book_hedge_position()` RPCs `SECURITY DEFINER`, locked
  `search_path`, call `validate_window_forward()`.

> **Note:** orbit-mvp has no server-side four-eyes approval gate
> (`assert_approval_for_action`) — that is a separate platform's feature. Window-forward
> booking and draw recording follow the same RLS + role gating (admin/editor write,
> viewer read-only) as every other hedge action in this repo. A four-eyes approval
> workflow is out of scope for this feature.

---

## 7. Types & Testing

- TypeScript discriminated union in `src/types/index.ts`:
  `HedgePosition = OutrightForward | WindowForward | Swap | Option | Spot`, where
  `WindowForward` carries non-null `window_start_date`, `window_end_date`,
  `drawn_notional`, `draws: HedgeDraw[]`.
- Regenerate `database.types.ts` (`npm run types:db`) after migrations.
- New hooks: `useWindowDraws(positionId)` (CRUD); `useHedgePositions` extended to hydrate
  draws for window positions.
- vitest `windowForward.test.ts` (~target 25 cases):
  - Fully-undrawn window MTM == vanilla forward MTM (parity)
  - Fully-drawn window MTM == 0 floating (all realized)
  - Partial draw reduces floating MTM proportionally
  - Coverage contribution == remaining notional
  - Per-draw effectiveness with divergent draw-date basis → realistic <100% offset
  - Buy/sell symmetry
  - Draw exceeding remaining notional rejected
  - Draw outside window rejected
  - Strategy D scoring favors timing-uncertain exposure base; underranks certain
- Security regression (`tests/security/*.test.mjs`): viewer cannot insert draws; a draw
  cannot exceed policy `max_draws_per_window`.

---

## 8. Documentation

- New `CLAUDE.md` session entry documenting the feature, `windowForward.ts`, the draws
  table, and the effective-notional coverage rule.
- Inline JSDoc on `windowForward.ts` exports.

---

## 9. Surface count

~22 files across 6 layers: 3 migrations, 1 new pure-TS module, 2 new hooks, entry form,
blotter draw flow, advisor engine + Strategy D, policy UI, onboarding capture, MTM at 4
call sites, coverage view, effectiveness engine, hedge accounting export, board reporting
(3 files), lifecycle guards, types, tests.

---

## 10. Out of scope (explicitly deferred)

- Real forward-curve market-data feed (v1 uses the existing `buildForwardCurve()`
  interest-rate-differential approximation; a live curve feed is a separate enhancement).
- Probability-weighted expected-draw-date MTM (v1 marks residual to window end —
  conservative).
- Window forwards on the commodity-risk module (FX only for v1).
