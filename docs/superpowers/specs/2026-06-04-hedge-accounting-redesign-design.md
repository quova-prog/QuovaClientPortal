# Hedge Accounting Engine (ASC 815 / IFRS 9) — Design Spec

> **Status:** Design-complete (upgraded from the 2026-06-04 scoping doc after a dedicated
> brainstorming pass). Ready for an implementation plan.
> **Date:** 2026-06-04 (designed) · brainstorming pass 2026-06-05
> **Companion spec:** `2026-06-04-window-forwards-design.md` — the economic instrument that
> emits no journal entries and defers all accounting here.
> **Origin:** Carved out of the window-forwards work after a hedge-accounting specialist
> review found the accounting materially incomplete. This is a **cross-cutting subsystem**
> that applies to **every** hedge instrument (forwards, window forwards, swaps, options) —
> not a window-forward sub-feature.

---

## 0. Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| **Architecture** | Period-snapshot ledger engine (immutable per-period rows; JEs read the ledger) |
| **v1 designation scope** | Cash flow + fair value + net investment (all three) |
| **Fair-value source** | Quova **indicative** MTM now + first-class `fair_value_source` field & bank-MTM ingestion hook; all output labeled indicative/preparatory until bank MTM is loaded |
| **Reclassification trigger** | Hedge lifecycle events (settle/maturity/close/draw) + linked-exposure settlement |
| **Probability governance** | Default `probable`; admin flags `not_probable` / `will_not_occur` (→ immediate AOCI reclass) |
| **Framework** | Per-org setting, **ASC 815 default**; IFRS 9 selectable |
| **Policy elections (#2/#3/#4)** | Conservative defaults, per-org configurable, every one flagged **"AUDITOR MUST CONFIRM"** |

> **Standing caveat:** Quova's accounting output is **indicative / preparatory**. Final
> ASC 815 / IFRS 9 designation, effectiveness, and journal entries must be reviewed by the
> customer's auditor using authoritative (bank) fair values. The engine never asserts
> "final" output while `fair_value_source = quova_indicative`.

---

## 1. Foundational principle — Economic P&L vs Accounting P&L

Two cleanly separated layers. **Accounting P&L is a function of the designation, never a
restatement of economic P&L.**

| Layer | What it is | Where it lives | Produces |
|---|---|---|---|
| **Economic P&L** | Derivative value / realized economics, for treasury | `hedge_positions`, `hedge_position_draws.realized_pnl_usd`, `windowForwardMtm` (already built) | Blotter, board, draw ledger. **No journal entries.** |
| **Accounting P&L** | Recognition under the designation, period by period | This project — `aoci_ledger` + JE generators | The hedge-accounting export / journal entries |

---

## 2. Data model (period-snapshot ledger)

Seven new tables. All carry `org_id`, RLS (`current_user_org_id()` + AAL2), and the
mandatory audit trigger. The three **ledger/measurement tables are append-only** — client
INSERT/UPDATE/DELETE blocked via `WITH CHECK (false)`; the only writer is the SECURITY
DEFINER engine. Locked periods reject all writes.

```
org_accounting_config            -- one row per org; the elections (each "AUDITOR MUST CONFIRM")
  org_id PK/FK,
  framework             TEXT  default 'asc815'   CHECK in ('asc815','ifrs9')
  designation_method    TEXT  default 'spot'     CHECK in ('spot','all_in_forward')
  forward_points_to     TEXT  default 'oci'      CHECK in ('oci','earnings')
  effectiveness_method  TEXT  default 'dollar_offset'
                              CHECK in ('critical_terms','dollar_offset','regression')
  aoci_allocation       TEXT  default 'pro_rata' CHECK in ('pro_rata','specific_id')
  assessment_frequency  TEXT  default 'quarterly' CHECK in ('monthly','quarterly')
  fair_value_source     TEXT  default 'quova_indicative' CHECK in ('quova_indicative','bank_mtm')
  updated_by, updated_at

hedge_designations               -- structured designation (supersedes hedge_type+notes)
  id, org_id, position_id FK,
  designation_type   TEXT CHECK in ('cash_flow','fair_value','net_investment')
  framework          TEXT  -- snapshot of org framework at designation time
  hedged_risk        TEXT  -- e.g. 'fx_spot'
  method             TEXT CHECK in ('spot','all_in_forward')
  excluded_components JSONB default '{}'  -- e.g. {"forward_points": true, "time_value": false}
  assessment_method  TEXT
  inception_doc      TEXT  -- contemporaneous documentation
  probability_status TEXT  default 'probable' CHECK in ('probable','not_probable','will_not_occur')
  basis_adjustment_usd NUMERIC(20,2) default 0  -- FVH only: cumulative hedged-item basis adj
  designated_at TIMESTAMPTZ, dedesignated_at TIMESTAMPTZ,
  dedesignation_reason TEXT, superseded_by_id UUID FK self,
  created_by, created_at

hedged_items                     -- forecast transaction(s) a designation covers
  id, org_id, designation_id FK,
  exposure_id UUID FK fx_exposures NULL, derived_source TEXT NULL, derived_ref TEXT NULL,
  forecast_window_start DATE, forecast_window_end DATE, forecast_amount NUMERIC(20,2),
  affects_earnings_on DATE NULL,   -- set when it hits earnings (reclass trigger)
  CONSTRAINT one_target CHECK ((exposure_id IS NOT NULL) <> (derived_source IS NOT NULL))

accounting_periods               -- close / lock control
  id, org_id, period TEXT,  -- 'YYYY-MM'
  status TEXT default 'open' CHECK in ('open','closed','locked'),
  closed_at, closed_by, locked_at, locked_by,
  UNIQUE(org_id, period)

fair_value_measurements          -- FV input per designation per period (append-only)
  id, org_id, designation_id FK, period TEXT,
  fair_value_usd NUMERIC(20,2), source TEXT CHECK in ('quova_indicative','bank_mtm'),
  spot NUMERIC(20,8), forward_rate NUMERIC(20,8), inputs JSONB,
  superseded_by_id UUID NULL, measured_at

effectiveness_assessments        -- per designation per period (append-only)
  id, org_id, designation_id FK, period TEXT, framework TEXT, method TEXT,
  actual_derivative_fv NUMERIC(20,2), hypothetical_derivative_fv NUMERIC(20,2),
  dollar_offset_ratio NUMERIC(8,4) NULL, regression_r2 NUMERIC(6,4) NULL,
  regression_slope NUMERIC(8,4) NULL,
  ifrs9_economic_relationship BOOLEAN NULL, ifrs9_hedge_ratio TEXT NULL,
  credit_risk_dominates BOOLEAN NULL,
  verdict TEXT CHECK in ('effective','ineffective','inconclusive'), rationale TEXT,
  superseded_by_id UUID NULL, assessed_at

aoci_ledger                      -- the heart: every AOCI/CTA movement (append-only)
  id, org_id, designation_id FK, hedged_item_id FK NULL, period TEXT,
  event_type TEXT CHECK in ('defer','reclassify','ineffective_to_earnings',
                            'forecast_failed','dedesignate'),
  bucket TEXT default 'aoci_cf' CHECK in ('aoci_cf','cta'),  -- CFH reserve vs NIH CTA
  amount_usd NUMERIC(20,2), balance_after_usd NUMERIC(20,2),
  source_event_ref TEXT, superseded_by_id UUID NULL, created_at
```

**Relationships:** one `hedge_designation` → many `hedged_items`. Each period close writes,
per designation: one `fair_value_measurement`, one `effectiveness_assessment`, and N
`aoci_ledger` rows. The ledger's running `balance_after_usd` is the auditable AOCI/CTA
reserve over time.

**Retires:** the thin `hedge_positions.hedge_type` + designation-note-in-`notes` (session 11)
is superseded by `hedge_designations`. `hedge_type` is kept as a denormalized mirror for
back-compat. Existing positions get a one-time backfill into `hedge_designations`
(`designation_type` from `hedge_type`, `method='spot'`, `probability_status='probable'`).

---

## 3. Period-close engine

`close_accounting_period(p_org_id, p_period)` — SECURITY DEFINER, idempotent until the
period is **locked**. Cannot close period N until N-1 is closed (no gaps). For each active
`hedge_designation` in the org:

1. **Measure FV** → `fair_value_measurements` (source = org `fair_value_source`; v1 =
   `quova_indicative` via the shared MTM helpers, labeled indicative).
2. **Assess effectiveness** (§4) → `effectiveness_assessments`.
3. **Compute AOCI movement** by designation type (§5) → append `aoci_ledger` rows.
4. **Reclassify** hedged items that affected earnings this period (§6).
5. **Apply probability / dedesignation** consequences (§7, §8).

Re-closing an **open** period supersedes that period's prior rows per designation
(`superseded_by_id` set — never deleted). `lock` freezes the period.

> **Implementation note:** the financial computation lives in a pure-TS module
> `src/lib/hedgeAccounting/` (testable in isolation). The SQL RPC orchestrates persistence
> and calls into validated inputs; the close can also be driven from a server context. The
> split mirrors `windowForward.ts` / `hedgeEffectiveness.ts`.

---

## 4. Effectiveness sub-engine (framework-split)

Persists results; branches by org framework. Actual derivative FV vs **hypothetical
derivative** at the designated `method` (spot vs all-in-forward), USD-converted.

- **ASC 815:** `critical_terms` (qualitative pass when terms match) → else `dollar_offset`
  (prospective + retrospective, **80–125% band**, configurable) → `regression` option
  (R²/slope). The 80–125% band is **one configurable convention, not the whole answer.**
- **IFRS 9:** qualitative — economic relationship exists, credit risk does not dominate,
  hedge ratio consistent with risk management. **No bright-line ratio.** Records rationale.

Ineffectiveness (actual-vs-hypothetical excess) always → **earnings**; the effective
portion moves to AOCI (CFH) / offsets the hedged item (FVH) / to CTA (NIH).

---

## 5. AOCI movement by designation type

- **Cash flow hedge (ASC 815-30):** effective FV change → AOCI (`defer`, bucket `aoci_cf`);
  ineffective → earnings (`ineffective_to_earnings`). Forward points per `forward_points_to`
  (OCI + systematic amortization, or earnings).
- **Fair value hedge (ASC 815-25):** derivative FV change → earnings; hedged item's
  attributable FV change → earnings with a **basis adjustment** tracked on the designation
  (`basis_adjustment_usd`). No AOCI.
- **Net investment hedge (ASC 815-35):** effective → **CTA in OCI** (bucket `cta`);
  ineffective → earnings.

`aoci_allocation` (`pro_rata` by hedged notional default; `specific_id` option) splits a
designation's movement across its `hedged_items`.

---

## 6. Reclassification sub-engine

When a `hedged_item.affects_earnings_on` falls within the closing period — set from **hedge
lifecycle events** (settlement / maturity / close / draw) or the **linked exposure** being
marked settled — the engine appends a `reclassify` row moving that item's accumulated AOCI
→ earnings. For CFH this is the deferred gain/loss hitting P&L alongside the hedged
transaction. Pro-rata or specific-ID per election.

---

## 7. Probability & failure

Default `probable`. Admin flags from the designation detail:
- **`not_probable`** (still expected) → stop deferring *new* movements; existing AOCI held.
- **`will_not_occur`** → append `forecast_failed` → **immediate full AOCI → earnings**
  (ASC 815-30-40-4).

Every transition is reason-coded and audit-logged (via `flag_designation_probability` RPC).

---

## 8. Dedesignation / redesignation

Consumes the **critical-term-change markers** the lifecycle emits (roll/amend/close changing
notional / rate / window / counterparty). On a qualifying change: append `dedesignate`
(freeze prospective accounting per type — CFH AOCI frozen and reclassified as the original
forecast still occurs; FVH basis adjustment amortized), set `dedesignated_at`, and
optionally create a **new** `hedge_designation` (`superseded_by_id` chain) for the amended
terms. **Voluntary dedesignation** is supported under ASC 815 but **blocked for IFRS 9**
(which prohibits it) — enforced by the framework setting in `dedesignate_hedge` RPC.

---

## 9. Journal-entry generators (read the ledger, never recompute)

`HedgeAccountingExport.tsx` is **inverted** into a formatter that reads `aoci_ledger` +
`fair_value_measurements` + `effectiveness_assessments` for a **closed** period and renders
balanced JEs. One generator per designation type, driven by ledger `event_type`:

- **CFH:** `defer` (gain Dr Derivative Asset / Cr AOCI; loss Dr AOCI / Cr Derivative
  Liability) · `ineffective_to_earnings` → P&L · `reclassify` (Dr AOCI / Cr Revenue-or-COGS)
  · `forecast_failed` (immediate AOCI → earnings).
- **FVH:** derivative FV → earnings + hedged-item **basis-adjustment** entry.
- **NIH:** effective → **CTA in OCI**; ineffective → earnings.

`AccountMap` (existing, configurable account codes) is extended with `cta_oci_reserve`,
`hedged_item_basis`, `forward_points_oci`. Every entry carries `period`, `designation_id`,
the `aoci_ledger` row ref, and `asc815Note` / `ifrs9Note`. **All output stamped
"INDICATIVE / PREPARATORY — fair value source: Quova indicative. Final entries require
auditor review and authoritative (bank) MTM"** until `fair_value_source = bank_mtm`.

XLSX sheets: **Journal Entries**, **AOCI Rollforward** (per designation: opening → defer →
reclass → closing — the auditor's key schedule), **Effectiveness Assessments**,
**Designations Register**.

---

## 10. Config & elections UI (Settings → Accounting, Pro/Enterprise)

New tab, one `org_accounting_config` row. Every field a control with an **"⚠ Auditor must
confirm"** chip: framework, designation method, forward-points treatment, effectiveness
method, AOCI allocation, assessment frequency, fair-value source.
- **Designations Register** — all designations (status, probability, AOCI balance) with
  per-designation actions: flag not-probable / will-not-occur, view rollforward, dedesignate.
- **Period Close** panel — periods with status (open/closed/locked), "Close period" (runs
  the engine), "Lock period," and the indicative-output banner.

Tier-gated to Pro/Enterprise (matches `email_notifications` / window-forwards gating).

---

## 11. Designation capture at booking (upgrade the thin step)

The session-11 designation step in `HedgePage` (hedge_type + a notes string) is upgraded to
write a structured `hedge_designations` + `hedged_items` record at inception: designation
type, hedged risk, method (defaults from org config), the hedged forecast transaction (link
to exposure/window), excluded components, inception documentation. `book_window_forward` and
the vanilla booking path both create the designation. This is the contemporaneous inception
record the engine needs (the forward-compat hook left in the window-forward spec).

---

## 12. Reporting touchpoints

- **AnalyticsPage → Hedge Accounting tab** becomes the period-close + export home (reads
  the ledger).
- **Board report** gains an optional **AOCI position** line (deferred hedge gains/losses)
  from the ledger — labeled indicative.
- **Effectiveness Testing** UI re-points to persisted `effectiveness_assessments`.

---

## 13. Security & integrity

- **Append-only** `aoci_ledger` / `fair_value_measurements` / `effectiveness_assessments`
  (`WITH CHECK (false)`); only the SECURITY DEFINER engine writes; locked periods immutable.
- All new tables: `org_id` + RLS (AAL2) + mandatory audit trigger. Config + designation
  writes admin/editor; period close/lock admin-only.
- Engine RPCs (`close_accounting_period`, `flag_designation_probability`,
  `dedesignate_hedge`, `record_designation`) are SECURITY DEFINER, locked `search_path`,
  caller org+role+tier checked, `org_id`-scoped (no cross-tenant leakage).
- Idempotency via supersede (never delete); gap-free period sequence enforced.

---

## 14. Testing

- **Pure-TS engine** `src/lib/hedgeAccounting/` — close logic, AOCI movement, effectiveness,
  reclassification as pure functions over typed inputs. ~40 vitest:
  - CFH full lifecycle: defer → reclassify-on-earnings → AOCI returns to zero
  - effective→AOCI / ineffective→earnings; 80–125% boundary cases
  - FVH basis adjustment; NIH → CTA bucket
  - `will_not_occur` → immediate full reclass; `not_probable` → stop deferring
  - dedesignation freezes prospective accounting; IFRS 9 blocks voluntary dedesignation
  - pro-rata vs specific-ID allocation across multiple hedged items
  - period idempotency (re-close supersedes, balances unchanged); gap prevention
  - ASC 815 vs IFRS 9 effectiveness branching
  - JE generators **balanced** (Σ debits = Σ credits) for every event type
- **Static security regressions** (`tests/security/*.test.mjs`): append-only policies,
  engine-only write path, AAL2, audit coverage.
- **Migration drift** check (regen `database.types.ts`).

---

## 15. Build phasing (the implementation plan will detail)

All three designation types are in v1 scope; the *build* sequences to de-risk. Each phase:
TDD, its own commit/push/deploy checkpoint, dashboard-applied migrations (the `db push`
desync remains unrepaired).

1. **Schema & config** — 7 tables, RLS, append-only policies, `org_accounting_config`,
   backfill existing positions → designations. Security regressions.
2. **Designation capture** — structured designation at booking (HedgePage +
   `book_window_forward`); Settings → Accounting config UI with auditor-confirm chips.
3. **Close engine — CFH** — `close_accounting_period`, FV measurement, ASC 815 effectiveness,
   CFH defer/reclassify/fail, period lock. Pure-TS engine + ~25 vitest. (Dominant path.)
4. **FVH + NIH** — fair-value basis adjustment + net-investment CTA in engine + JE generators.
5. **IFRS 9** — qualitative effectiveness branch, no-voluntary-dedesignation rule.
6. **Reporting** — invert `HedgeAccountingExport` to ledger-reader, AOCI rollforward sheet,
   board AOCI line, effectiveness UI re-point.

---

## 16. Out of scope (v1)

- **Bank-MTM ingestion** — `fair_value_source` field + hook exist; the upload/API path is a
  fast-follow. Until then, output is indicative/preparatory.
- **GL feed reclassification** — using lifecycle/exposure signals instead.
- **`supabase db push` history repair** — flagged separately; doesn't block this work.
- **Partial-term / time-value option hedge mechanics, hedge of net positions, layered/
  proportional hedges** — beyond the v1 designation machinery.
