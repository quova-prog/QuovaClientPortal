# Hedge Accounting Engine (ASC 815 / IFRS 9) — Design Spec

> **Status:** Design-revised after hedge-accounting review. Ready for an implementation
> plan **after auditor sign-off on the policy elections and framework-specific mechanics**.
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
| **Fair-value source** | Quova **indicative** MTM now + first-class `fair_value_source`, `fair_value_hierarchy`, and bank-MTM ingestion hook; journal output remains draft/preparatory until an auditor-approved valuation source is loaded |
| **Reclassification trigger** | `hedged_item.affects_earnings_on` is authoritative. Hedge lifecycle events (settle/maturity/close/draw) and linked-exposure settlement are evidence/signals, not automatic P&L triggers |
| **Probability governance** | Default `probable`; admin flags `no_longer_probable_still_expected` / `probable_not_to_occur` (→ immediate AOCI reclass) |
| **Framework** | Per-org setting, **ASC 815 default**; IFRS 9 selectable |
| **Policy elections (#2/#3/#4)** | Conservative defaults, per-org configurable, every one flagged **"AUDITOR MUST CONFIRM"** |

> **Standing caveat:** Quova's accounting output is **indicative / preparatory**. Final
> ASC 815 / IFRS 9 designation, effectiveness, and journal entries must be reviewed by the
> customer's auditor using authoritative (bank) fair values. The engine never asserts
> "final" output while `fair_value_source = quova_indicative`, and backfilled designations
> are marked preparatory unless contemporaneous inception documentation exists.

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

Eight new tables. All carry `org_id`, RLS (`current_user_org_id()` + AAL2), and the
mandatory audit trigger. The four **ledger/measurement tables are append-only** — client
INSERT/UPDATE/DELETE blocked via `WITH CHECK (false)`; the only writer is the accounting
close service through SECURITY DEFINER persistence RPCs. Locked periods reject all writes.

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
  fair_value_hierarchy  TEXT  default 'level_2_indicative'
                              CHECK in ('level_1','level_2_bank','level_2_indicative','level_3')
  reporting_currency    TEXT  default 'USD'  -- org presentation/reporting currency
  journal_output_mode   TEXT  default 'draft' CHECK in ('draft','auditor_approved')
  updated_by, updated_at

hedge_designations               -- structured designation (supersedes hedge_type+notes)
  id, org_id, position_id FK,
  designation_type   TEXT CHECK in ('cash_flow','fair_value','net_investment')
  framework          TEXT  -- snapshot of org framework at designation time
  accounting_status  TEXT default 'preparatory'
                     CHECK in ('preparatory','designated','dedesignated','disqualified')
  inception_doc_status TEXT default 'missing'
                     CHECK in ('complete','incomplete','missing','backfilled')
  hedged_risk        TEXT  -- e.g. 'fx_spot'
  method             TEXT CHECK in ('spot','all_in_forward')
  excluded_components JSONB default '{}'  -- e.g. {"forward_points": true, "time_value": false}
  assessment_method  TEXT
  inception_doc      TEXT  -- contemporaneous documentation
  probability_status TEXT  default 'probable'
                     CHECK in ('probable','no_longer_probable_still_expected',
                               'probable_not_to_occur')
  functional_currency TEXT NULL -- entity functional currency at designation time
  basis_adjustment_usd NUMERIC(20,2) default 0  -- FVH only: cumulative hedged-item basis adj
  designated_at TIMESTAMPTZ, dedesignated_at TIMESTAMPTZ,
  dedesignation_reason TEXT, superseded_by_id UUID FK self,
  created_by, created_at

hedged_items                     -- forecast transaction(s) a designation covers
  id, org_id, designation_id FK,
  exposure_id UUID FK fx_exposures NULL, derived_source TEXT NULL, derived_ref TEXT NULL,
  forecast_window_start DATE, forecast_window_end DATE, forecast_amount NUMERIC(20,2),
  affects_earnings_on DATE NULL,   -- authoritative reclass trigger: when hedged item hits earnings
  earnings_event_source TEXT NULL CHECK in ('exposure','erp','manual','lifecycle_signal'),
                                    -- 'lifecycle_signal' only after accounting review accepts it
  lifecycle_settlement_date DATE NULL, -- evidence only; not a P&L trigger by itself
  CONSTRAINT one_target CHECK ((exposure_id IS NOT NULL) <> (derived_source IS NOT NULL))

accounting_periods               -- close / lock control
  id, org_id, period TEXT,  -- 'YYYY-MM'
  status TEXT default 'open' CHECK in ('open','closed','locked'),
  closed_at, closed_by, locked_at, locked_by,
  UNIQUE(org_id, period)

fair_value_measurements          -- FV input per designation per period (append-only)
  id, org_id, designation_id FK, period TEXT,
  fair_value_usd NUMERIC(20,2), source TEXT CHECK in ('quova_indicative','bank_mtm'),
  fair_value_hierarchy TEXT CHECK in ('level_1','level_2_bank','level_2_indicative','level_3'),
  valuation_provider TEXT NULL, source_document_ref TEXT NULL,
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
  event_type TEXT CHECK in ('defer','reclassify','ifrs9_ineffective_to_earnings',
                            'forecast_failed','dedesignate','cost_of_hedging'),
  bucket TEXT default 'aoci_cf' CHECK in ('aoci_cf','cta'),  -- CFH reserve vs NIH CTA
  amount_usd NUMERIC(20,2), balance_after_usd NUMERIC(20,2),
  source_event_ref TEXT, superseded_by_id UUID NULL, created_at

derivative_accounting_ledger     -- derivative carrying value and settlement movements
  id, org_id, designation_id FK, position_id FK hedge_positions,
  draw_id UUID FK hedge_position_draws NULL, period TEXT,
  event_type TEXT CHECK in ('mtm_to_fair_value','partial_settlement','full_settlement',
                            'early_close','excluded_component_amortization'),
  amount_usd NUMERIC(20,2), derivative_balance_after_usd NUMERIC(20,2),
  fair_value_measurement_id UUID FK fair_value_measurements NULL,
  source_event_ref TEXT, superseded_by_id UUID NULL, created_at
```

**Relationships:** one `hedge_designation` → many `hedged_items`. Each period close writes,
per designation: one `fair_value_measurement`, one `effectiveness_assessment`, N
`aoci_ledger` rows, and derivative carrying/settlement rows as needed. The ledger's running
`balance_after_usd` is the auditable AOCI/CTA reserve over time; the derivative ledger's
`derivative_balance_after_usd` is the auditable carrying value over time.

**Retires:** the thin `hedge_positions.hedge_type` + designation-note-in-`notes` (session 11)
is superseded by `hedge_designations`. `hedge_type` is kept as a denormalized mirror for
back-compat. Existing positions get a one-time **preparatory** backfill into
`hedge_designations` (`designation_type` from `hedge_type`, `method='spot'`,
`probability_status='probable'`, `accounting_status='preparatory'`,
`inception_doc_status='backfilled'`). They do **not** become accounting-qualified unless
contemporaneous inception documentation is attached and approved by the customer/auditor.

---

## 3. Period-close engine

`close_accounting_period(p_org_id, p_period)` — an admin-only server/Edge Function command
backed by SECURITY DEFINER persistence RPCs, idempotent until the period is **locked**.
Cannot close period N until N-1 is closed (no gaps). For each active `hedge_designation`
in the org:

1. **Load close inputs** — org config, active designations, hedged items, prior reserve
   balances, prior derivative carrying balances, current lifecycle events, and approved
   period status.
2. **Measure FV** -> `fair_value_measurements` (source = org `fair_value_source`; v1 =
   `quova_indicative` via the shared MTM helpers, labeled indicative). If the source is
   indicative, the close may produce draft schedules but cannot produce final journals.
3. **Write derivative carrying movements** -> `derivative_accounting_ledger`, including
   MTM-to-fair-value rows and settlement rows for partial draws, full settlement, early close,
   or excluded-component amortization. These rows clear or reduce the derivative carrying
   balance; they do not by themselves reclassify AOCI/CTA.
4. **Assess effectiveness** (§4) -> `effectiveness_assessments`.
5. **Compute accounting reserve / earnings / basis movements** by designation type (§5) ->
   append `aoci_ledger` rows where the framework requires reserve activity.
6. **Reclassify** hedged items whose `affects_earnings_on` falls in the period (§6).
7. **Apply probability / dedesignation** consequences (§7, §8).

Re-closing an **open** period supersedes that period's prior rows per designation
(`superseded_by_id` set — never deleted). If a prior open period is re-closed, all later
open periods that depend on the superseded running balances must be invalidated/re-closed
before they can be locked. `lock` freezes the period and requires final-output gating to pass.

> **Implementation note:** the financial computation lives in a pure-TS module
> `src/lib/hedgeAccounting/` (testable in isolation). A Postgres RPC cannot call TypeScript;
> the server/Edge Function orchestrates the pure-TS engine and calls narrow SECURITY DEFINER
> RPCs for role/org validation, period locks, and append-only row writes. The split mirrors
> `windowForward.ts` / `hedgeEffectiveness.ts`.

---

## 4. Effectiveness sub-engine (framework-split)

Persists results; branches by org framework. Actual derivative FV vs **hypothetical
derivative** at the designated `method` (spot vs all-in-forward), USD-converted.

- **ASC 815:** `critical_terms` (qualitative pass when terms match) → else `dollar_offset`
  (prospective + retrospective, **80–125% band**, configurable) → `regression` option
  (R²/slope). The 80–125% band is **one configurable convention, not the whole answer.**
- **IFRS 9:** qualitative — economic relationship exists, credit risk does not dominate,
  hedge ratio consistent with risk management. **No bright-line ratio.** Records rationale.

The assessment result controls whether hedge accounting may continue. The accounting
consequence is framework-specific:

- **ASC 815 cash flow / net investment hedges:** for a qualifying hedge under the current
  ASC 815 model, changes included in the effectiveness assessment are generally deferred in
  OCI/CTA. The engine must not create a standalone "ineffectiveness to earnings" JE for
  ASC 815 CFH/NIH just because actual and hypothetical derivative values differ. If the
  hedge fails qualification, hedge accounting is discontinued prospectively and future
  derivative changes go to earnings.
- **ASC 815 fair value hedges:** derivative fair-value changes and the hedged item's
  attributable basis adjustment both go through earnings; earnings volatility comes from
  mismatch between those two measurements.
- **IFRS 9:** records economic relationship, hedge-ratio, and credit-risk-dominance
  conclusions. Cash flow hedge reserve uses IFRS 9 lower-of mechanics; hedge
  ineffectiveness, when measured, goes to earnings.

Window forwards require extra conservatism for `critical_terms`: flexible draw timing often
means the hedged item and derivative do not perfectly match. The engine should fall back to
dollar-offset or regression unless the documentation proves the window, amount, currency,
and expected timing match the hedged risk tightly enough.

---

## 5. Reserve / earnings movement by designation type

- **Cash flow hedge (ASC 815-30):** qualifying changes included in the effectiveness
  assessment -> AOCI (`defer`, bucket `aoci_cf`). Excluded components follow the org's
  documented election (`forward_points_to`: systematic amortization through earnings, or OCI
  treatment where allowed and confirmed). A failed or discontinued hedge sends future
  derivative changes to earnings prospectively; existing AOCI treatment follows §7/§8.
- **Cash flow hedge (IFRS 9):** cash flow hedge reserve is the lower of cumulative gain/loss
  on the hedging instrument and cumulative change in the hedged item. Hedge ineffectiveness
  -> earnings (`ifrs9_ineffective_to_earnings`). Eligible excluded components may be recorded
  in a cost-of-hedging reserve (`cost_of_hedging`) if the customer elects and documents it.
- **Fair value hedge (ASC 815 / IFRS 9):** derivative FV change -> earnings; hedged item's
  attributable FV change -> earnings with a **basis adjustment** tracked on the designation
  (`basis_adjustment_usd`). No AOCI.
- **Net investment hedge:** qualifying effective portion -> **CTA in OCI** (bucket `cta`).
  ASC 815 does not create a generic ineffectiveness-to-earnings entry for qualifying NIH
  activity; IFRS 9 follows IFRS ineffectiveness rules where applicable.

`aoci_allocation` (`pro_rata` by hedged notional default; `specific_id` option) splits a
designation's reserve movement across its `hedged_items`. It does not allocate derivative
settlement/carrying-value rows; those are tied to the position/draw in
`derivative_accounting_ledger`.

All amounts are calculated in the designation's functional currency where required and
translated to the org `reporting_currency` for ledger/export presentation. The implementation
plan must name the FX rate source used for translation before any final journals are enabled.

---

## 6. Reclassification sub-engine

When a `hedged_item.affects_earnings_on` falls within the closing period, the engine appends
a `reclassify` row moving that item's accumulated AOCI -> earnings. This date is
authoritative and must come from the exposure/ERP/manual accounting workflow that identifies
when the hedged forecast transaction affects earnings.

Hedge lifecycle events (settlement / maturity / close / window-forward draw) and linked
exposure settlement are evidence only. They may populate `lifecycle_settlement_date`, create
a review task, or suggest a default `affects_earnings_on`, but they must not automatically
reclassify AOCI. Examples:

- Inventory purchases: the derivative may settle at purchase, but AOCI is reclassified when
  inventory affects earnings through COGS.
- Capital expenditures: AOCI is reclassified over depreciation/amortization when that is the
  documented hedged item effect.
- AR/AP cash settlements: the earnings event may align with invoice remeasurement or
  settlement, depending on the documented hedged risk and accounting policy.

For CFH, reclassification should be presented in the same income-statement line item as the
hedged transaction when the account mapping is available. Pro-rata or specific-ID allocation
uses the org election.

---

## 7. Probability & failure

Default `probable`. Admin flags from the designation detail:
- **`no_longer_probable_still_expected`** -> discontinue prospective hedge accounting; stop
  deferring new qualifying movements. Existing AOCI remains in the reserve until the forecast
  transaction affects earnings.
- **`probable_not_to_occur`** -> append `forecast_failed` -> **immediate full AOCI ->
  earnings** (ASC 815-30-40-4; IFRS 9 has comparable discontinuation/recycling mechanics).

Every transition is reason-coded and audit-logged (via `flag_designation_probability` RPC).

---

## 8. Dedesignation / redesignation

Consumes the **critical-term-change markers** the lifecycle emits (roll/amend/close changing
notional / rate / window / counterparty). Forced dedesignation/discontinuation also occurs
when eligibility, effectiveness, probability, or documentation requirements are no longer
met. On a qualifying change: append `dedesignate`, freeze prospective accounting per type,
set `dedesignated_at`, and optionally create a **new** `hedge_designation`
(`superseded_by_id` chain) for the amended terms.

Existing balances follow the probability conclusion: if the forecast transaction is still
expected, CFH AOCI remains until the hedged item affects earnings; if it is probable not to
occur, AOCI is immediately released to earnings. FVH basis adjustments are amortized or
otherwise recognized under the documented hedged-item accounting. **Voluntary dedesignation**
is supported under ASC 815 but **blocked for IFRS 9** (which prohibits voluntary
dedesignation when the risk-management objective is unchanged) — enforced by the framework
setting in `dedesignate_hedge` RPC.

For window forwards, a partial draw is normally an expected settlement event, not automatic
dedesignation. Amending/rolling/closing the residual window, changing counterparty, changing
the fixed rate, or materially changing available notional can trigger dedesignation and a
new designation for the amended residual terms.

---

## 9. Journal-entry generators (read the ledger, never recompute)

`HedgeAccountingExport.tsx` is **inverted** into a formatter that reads
`derivative_accounting_ledger` + `aoci_ledger` + `fair_value_measurements` +
`effectiveness_assessments` for a **closed** period and renders balanced JEs. One generator
per designation type, driven by ledger `event_type`:

- **Derivative carrying / settlement:** `mtm_to_fair_value` records derivative asset/liability
  to fair value. `partial_settlement`, `full_settlement`, and `early_close` clear the
  settled portion of derivative carrying value against cash/settlement accounts and realized
  settlement results, without reclassifying AOCI unless §6 is triggered.
- **ASC 815 CFH:** `defer` records qualifying changes to AOCI. `reclassify` moves AOCI to
  the mapped P&L line when the hedged item affects earnings. `forecast_failed` releases
  remaining AOCI to earnings. No generic ASC 815 CFH `ineffective_to_earnings` JE.
- **IFRS 9 CFH:** `defer`, `cost_of_hedging`, `ifrs9_ineffective_to_earnings`,
  `reclassify`, and `forecast_failed` render according to the IFRS 9 lower-of/cost-of-hedging
  calculations.
- **FVH:** derivative FV -> earnings + hedged-item **basis-adjustment** entry.
- **NIH:** qualifying activity -> **CTA in OCI**; IFRS ineffectiveness entries only when
  framework rules require them.

`AccountMap` (existing, configurable account codes) is extended with `cta_oci_reserve`,
`hedged_item_basis`, `forward_points_oci`, `cost_of_hedging_reserve`,
`ifrs9_ineffectiveness_pnl`, `derivative_settlement_cash`, and
`derivative_settlement_gain_loss`. Every entry carries `period`, `designation_id`, the
source ledger row refs, and `asc815Note` / `ifrs9Note`.

Final-output gate: journal exports are stamped **"INDICATIVE / PREPARATORY — fair value
source: Quova indicative. Final entries require auditor review and authoritative (bank)
MTM"** unless both `journal_output_mode = 'auditor_approved'` and the relevant fair-value
measurements use an approved valuation source/hierarchy (`bank_mtm` / `level_2_bank` or
better under the org policy).

XLSX sheets: **Journal Entries**, **AOCI Rollforward** (per designation: opening → defer →
reclass → closing — the auditor's key schedule), **Effectiveness Assessments**,
**Designations Register**.

---

## 10. Config & elections UI (Settings → Accounting, Pro/Enterprise)

New tab, one `org_accounting_config` row. Every field a control with an **"⚠ Auditor must
confirm"** chip: framework, designation method, forward-points treatment, effectiveness
method, AOCI allocation, assessment frequency, fair-value source, fair-value hierarchy,
reporting currency, journal output mode.
- **Designations Register** — all designations (status, probability, AOCI balance) with
  per-designation actions: flag no-longer-probable-still-expected /
  probable-not-to-occur, view rollforward, dedesignate.
- **Period Close** panel — periods with status (open/closed/locked), "Close period" (runs
  the engine), "Lock period," final-output gating status, and the indicative-output banner.

Tier-gated to Pro/Enterprise (matches `email_notifications` / window-forwards gating).

---

## 11. Designation capture at booking (upgrade the thin step)

The session-11 designation step in `HedgePage` (hedge_type + a notes string) is upgraded to
write a structured `hedge_designations` + `hedged_items` record at inception when the user
elects hedge-accounting treatment. The record must capture: designation type, hedged risk,
method (defaults from org config), hedging instrument, hedged forecast transaction or hedged
item (link to exposure/window), risk-management objective, effectiveness method, excluded
components, probability assertion, functional currency, expected P&L line/reclass mapping,
and inception documentation.

`book_window_forward` and the vanilla booking path can create **preparatory** designation
records by default, but they must not mark a designation `designated` unless the required
contemporaneous documentation is complete and the designation passes type-specific
eligibility validation:

- **CFH:** forecast transaction is documented, expected/probable, hedged risk is eligible,
  and reclassification policy/account mapping is captured.
- **FVH:** recognized asset/liability or firm commitment and hedged risk/basis-adjustment
  mechanics are documented.
- **NIH:** net investment relationship, functional currency, and CTA presentation are
  documented.

Backfilled or note-only records stay `preparatory` / `backfilled`; they can support draft
analysis but not final hedge-accounting journals.

---

## 12. Reporting touchpoints

- **AnalyticsPage → Hedge Accounting tab** becomes the period-close + export home (reads
  the ledger).
- **Board report** gains an optional **AOCI position** line (deferred hedge gains/losses)
  from the ledger — labeled indicative.
- **Effectiveness Testing** UI re-points to persisted `effectiveness_assessments`.

---

## 13. Security & integrity

- **Append-only** `aoci_ledger` / `derivative_accounting_ledger` /
  `fair_value_measurements` / `effectiveness_assessments` (`WITH CHECK (false)`); only
  server/Edge close flows using SECURITY DEFINER persistence RPCs can write; locked periods
  immutable.
- All new tables: `org_id` + RLS (AAL2) + mandatory audit trigger. Config + designation
  writes admin/editor; period close/lock admin-only.
- Engine RPCs (`close_accounting_period`, `flag_designation_probability`,
  `dedesignate_hedge`, `record_designation`, append-only ledger persistence helpers) are
  SECURITY DEFINER, locked `search_path`, caller org+role+tier checked, `org_id`-scoped
  (no cross-tenant leakage).
- Idempotency via supersede (never delete); gap-free period sequence enforced. Re-closing a
  prior open period marks later dependent open closes stale until recomputed, because
  `balance_after_usd` and `derivative_balance_after_usd` are running balances.
- Locked/final outputs require `journal_output_mode = 'auditor_approved'`, non-indicative
  fair values under the org policy, and all designations in the output to have
  `accounting_status = 'designated'` with complete inception documentation.

---

## 14. Testing

- **Pure-TS engine** `src/lib/hedgeAccounting/` — close logic, AOCI movement, effectiveness,
  derivative carrying/settlement movement, and reclassification as pure functions over typed
  inputs. ~55 vitest:
  - CFH full lifecycle: defer → reclassify-on-earnings → AOCI returns to zero
  - ASC 815 CFH qualifying changes -> AOCI with no standalone ineffectiveness JE
  - IFRS 9 CFH lower-of reserve mechanics + `ifrs9_ineffective_to_earnings`
  - 80–125% boundary cases treated as configurable ASC 815 dollar-offset policy, not IFRS 9
  - FVH basis adjustment; NIH → CTA bucket
  - `probable_not_to_occur` → immediate full reclass;
    `no_longer_probable_still_expected` → stop deferring while holding existing AOCI
  - lifecycle draw/settlement does not reclass AOCI until `affects_earnings_on`
  - window-forward partial draw records derivative carrying settlement and leaves reserve
    treatment to the designation rules
  - backfilled designation remains preparatory and cannot produce final journals
  - Quova-indicative valuation blocks final-output mode / final export stamp
  - functional/reporting-currency translation path uses the configured rate source
  - dedesignation freezes prospective accounting; IFRS 9 blocks voluntary dedesignation
  - pro-rata vs specific-ID allocation across multiple hedged items
  - period idempotency (re-close supersedes, balances unchanged); gap prevention
  - ASC 815 vs IFRS 9 effectiveness branching
  - JE generators **balanced** (Σ debits = Σ credits) for every event type
- **Static security regressions** (`tests/security/*.test.mjs`): append-only policies,
  engine-only write path, derivative ledger coverage, AAL2, audit coverage.
- **Migration drift** check (regen `database.types.ts`).

---

## 15. Build phasing (the implementation plan will detail)

All three designation types are in v1 scope; the *build* sequences to de-risk. Each phase:
TDD, its own commit/push/deploy checkpoint, dashboard-applied migrations (the `db push`
desync remains unrepaired).

1. **Schema & config** — 8 tables, RLS, append-only policies, `org_accounting_config`,
   derivative accounting ledger, backfill existing positions → preparatory designations.
   Security regressions.
2. **Designation capture** — structured designation at booking (HedgePage +
   `book_window_forward`); eligibility validation; complete/preparatory inception-doc
   statuses; Settings → Accounting config UI with auditor-confirm chips.
3. **Close engine — ASC 815 CFH** — server/Edge close orchestration, FV measurement,
   derivative carrying ledger, ASC 815 effectiveness, CFH defer/reclassify/fail, draft/final
   output gating, period lock. Pure-TS engine + focused vitest. (Dominant path.)
4. **FVH + NIH** — fair-value basis adjustment + net-investment CTA in engine + JE generators.
5. **IFRS 9** — qualitative effectiveness branch, lower-of reserve mechanics,
   cost-of-hedging support, IFRS ineffectiveness-to-earnings events,
   no-voluntary-dedesignation rule.
6. **Reporting** — invert `HedgeAccountingExport` to ledger-reader, AOCI rollforward sheet,
   board AOCI line, effectiveness UI re-point.

---

## 16. Out of scope (v1)

- **Bank-MTM ingestion** — `fair_value_source` field + hook exist; the upload/API path is a
  fast-follow. Until then, output is indicative/preparatory and cannot be labeled final.
- **Full GL/ERP feed reclassification automation** — v1 uses manual/exposure/ERP-provided
  `affects_earnings_on` plus lifecycle signals for review.
- **`supabase db push` history repair** — flagged separately; doesn't block this work.
- **Partial-term / time-value option hedge mechanics, hedge of net positions, layered/
  proportional hedges** — beyond the v1 designation machinery.
