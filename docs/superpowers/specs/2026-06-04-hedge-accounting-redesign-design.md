# Hedge Accounting Redesign (ASC 815 / IFRS 9) — Scoping Spec

> **Status:** Scoping / problem statement — **NOT design-complete.** Needs its own
> dedicated brainstorming pass (with CFO/controller/auditor input) before an
> implementation plan is written.
> **Date:** 2026-06-04
> **Origin:** Carved out of the window-forwards spec after a hedge-accounting specialist
> review found the accounting treatment materially incomplete. Accounting is a
> cross-cutting subsystem that applies to **every** hedge instrument — vanilla forwards,
> window forwards, swaps, options — not a window-forward sub-feature.
> **Companion spec:** `2026-06-04-window-forwards-design.md` (economic instrument; emits
> no journal entries; defers all accounting here).

---

## 1. Why this is its own project

The current `HedgeAccountingExport.tsx` already does *some* of this: for a designated
cash-flow hedge it routes MTM to AOCI (Dr Derivative Asset / Cr AOCI), and for a
fair-value hedge it routes MTM to earnings. But it is missing the structural pieces that
make hedge accounting actually correct and auditor-defensible:

- **No designation layer.** `hedge_type` is a single column on `hedge_positions`; there is
  no record of the hedged item(s), the forecast transaction(s), the risk being hedged, the
  designation method, excluded components, inception documentation, or the probability
  assertion.
- **No AOCI allocation/reclassification ledger.** A derivative can hedge multiple forecast
  transactions; its AOCI gain/loss must be allocated across them and reclassified to
  earnings **when each hedged item affects earnings** — not when the derivative settles.
- **No probability/failure handling.** If a forecast transaction becomes not probable, or
  will not occur, ASC 815 requires specific AOCI reclassification treatment.
- **No separation of ASC 815 and IFRS 9.** The two frameworks measure effectiveness
  differently; IFRS 9 has no 80–125% bright line.
- **No dedesignation/redesignation.** Roll/amend/close that change critical terms can end
  one hedge relationship and start another.
- **Fair value is approximate.** Quova's indicative MTM is not an ASC 820 exit-price fair
  value; bank MTM (or a defensible model) must be the accounting source of truth.

These are instrument-agnostic. Building a correct version once, here, fixes hedge
accounting for the whole platform.

---

## 2. The core reframing — Economic P&L vs Accounting P&L

The single most important change. Today the code blurs them; this redesign separates them
cleanly:

| Layer | What it is | Where it lives | Drives |
|---|---|---|---|
| **Economic P&L** | Realized + unrealized economics of the derivative itself, at trade/draw/settlement. Direction-aware, USD-converted, recorded at event time. | `hedge_positions`, `hedge_position_draws` (already built by the window-forward spec) | Treasury analytics, blotter, board MTM tiles. **No journal entries.** |
| **Accounting P&L** | Recognition under the applicable standard, driven by the **designation**. | This spec: `hedge_designations`, `aoci_ledger`, reclassification engine | The hedge-accounting export / journal entries |

Accounting P&L is a *function of the designation*, not a restatement of economic P&L:

- **Cash flow hedge (ASC 815-30):** effective FV change → OCI/AOCI; **reclassified to
  earnings when the hedged forecast transaction affects earnings.** Settlement of the
  derivative reduces the derivative asset/liability and cash; it does **not** by itself hit
  earnings.
- **Fair value hedge (ASC 815-25):** derivative FV change → earnings; **hedged item's
  attributable FV change → earnings** with a basis/carrying-amount adjustment to the
  hedged item.
- **Net investment hedge (ASC 815-35):** effective portion → CTA in OCI.
- **Undesignated:** derivative FV change → earnings each period.
- **IFRS 9:** separate effectiveness model (below); CFH/FVH mechanics broadly parallel but
  with IFRS 9 specifics (cost of hedging, rebalancing, no voluntary dedesignation).

---

## 3. Findings from the specialist review (the work items)

1. **Settlement ≠ recognition (CFH).** Reclassify AOCI → earnings when the hedged item
   affects earnings; prove/link the draw (or settlement) to the hedged forecast
   transaction's earnings impact. Do not hit P&L at derivative settlement.
2. **Effectiveness must be fair-value/cash-flow-offset of actual vs hypothetical
   derivative**, with current market inputs, direction, USD conversion, and a
   discounting/materiality policy — using the designated method (spot vs all-in forward).
   Must be internally consistent with the MTM model.
3. **Separate ASC 815 from IFRS 9.** ASC 815: configurable dollar-offset and/or regression,
   with the 80–125% range as *one* convention, not the whole answer. IFRS 9: qualitative
   economic-relationship test, credit-risk-not-dominating, and hedge-ratio — **no bright
   line**, plus rebalancing and cost-of-hedging.
4. **Designation records** (`hedge_designations`): hedged item(s), forecast transaction +
   its specified period/window, risk being hedged, spot vs all-in-forward method, excluded
   components (e.g. forward points, time value, cross-currency basis), assessment method
   and frequency, inception documentation, probability assertion, and
   dedesignation/redesignation history.
5. **AOCI allocation/reclassification ledger.** When one derivative hedges multiple
   forecast transactions, allocate its AOCI gain/loss across them and reclassify each piece
   on its own schedule.
6. **Probability & failure handling.** Forecast-transaction timing uncertainty is allowed
   within the originally specified period; add end-of-window probability checks; if the
   forecast becomes not probable (still expected) → stop deferring; if it will not occur →
   immediate AOCI reclassification to earnings.
7. **Fair value source of truth.** Bank MTM or a defensible ASC 820 exit-price model is
   authoritative for accounting; Quova indicative MTM is for treasury display only and is
   labeled as such.
8. **Lifecycle → accounting events.** Consume the "critical-term-change" markers the
   window-forward (and other instrument) lifecycle emits; perform dedesignation, account
   for the discontinued relationship's AOCI, and create the new designation.

---

## 4. Target data model (draft — to be refined in brainstorming)

```
hedge_designations
  id, org_id, position_id (FK hedge_positions),
  designation_type  -- 'cash_flow' | 'fair_value' | 'net_investment' | 'undesignated'
  framework         -- 'asc815' | 'ifrs9'
  hedged_risk       -- 'fx_spot' | 'fx_forward' | ...
  method            -- 'spot' | 'all_in_forward'
  excluded_components -- e.g. forward points / time value / cc-basis (JSONB)
  assessment_method -- 'critical_terms' | 'dollar_offset' | 'regression' | 'qualitative_ifrs9'
  assessment_frequency
  inception_doc     -- text / reference
  probability_assertion
  designated_at, dedesignated_at, dedesignation_reason,
  superseded_by_id  -- redesignation chain

hedged_items
  id, designation_id (FK), org_id,
  -- the forecast transaction(s) this designation covers
  exposure_id (FK fx_exposures) | derived_source + derived_ref,
  forecast_window_start, forecast_window_end,
  forecast_amount, probability_status -- 'probable' | 'not_probable' | 'will_not_occur'

aoci_ledger
  id, org_id, designation_id (FK), hedged_item_id (FK),
  event_type   -- 'defer' | 'reclassify' | 'ineffective_to_earnings' | 'forecast_failed'
  period, amount_usd, balance_after,
  source_event -- link to the MTM measurement / draw / settlement that produced it
  created_at

effectiveness_assessments
  id, org_id, designation_id (FK), framework, method,
  period, actual_derivative_fv, hypothetical_derivative_fv,
  dollar_offset_ratio,           -- ASC 815 numeric
  regression_r2, regression_slope, -- ASC 815 regression option
  ifrs9_economic_relationship,   -- qualitative pass/fail + rationale
  ifrs9_hedge_ratio, credit_risk_dominates,
  verdict, rationale, assessed_at
```

All new tables get RLS (`current_user_org_id()`, AAL2) and the mandatory audit trigger.

---

## 5. Open design decisions (for the brainstorming pass)

These need CFO/controller/auditor input before an implementation plan:

1. **Fair value source.** Bank MTM ingestion mechanism (file upload? bank API?) vs a
   defensible internal ASC 820 model. What's authoritative, and what's the fallback?
2. **Designation method default** (spot vs all-in forward) and excluded-components policy
   (forward points to OCI vs earnings under ASU 2017-12 elections).
3. **Effectiveness method per framework** — dollar-offset vs regression for ASC 815;
   qualitative thresholds for IFRS 9; assessment frequency.
4. **AOCI allocation rule** across multiple forecast transactions (pro-rata by amount? by
   timing? specific identification?).
5. **Reclassification trigger** — how Quova learns the hedged item affected earnings
   (exposure settlement event? GL feed? manual close?).
6. **Probability governance** — who attests probability, how the not-probable /
   will-not-occur transitions are recorded and approved.
7. **IFRS 9 vs ASC 815 selection** — per org? per designation? Both in parallel for dual
   reporters?
8. **Scope of v1** — which designation types ship first (CFH is the common case for the
   target customers; FVH and net-investment later?).

---

## 6. Relationship to the window-forward spec

- The window-forward spec ships the **economic** instrument and emits, on lifecycle
  changes, structured **critical-term-change markers** and per-draw economic facts. It
  produces **no** journal entries and **no** effectiveness verdicts.
- This spec consumes those facts and markers to produce **accounting** recognition.
- Sequencing: window forwards can ship and deliver treasury value with indicative MTM
  before this lands. Nothing window-forward may be called "auditor-ready" until this ships.

---

## 7. Next step

This is a **scoping document, not a finished design.** Before any implementation:

1. Run a dedicated brainstorming pass on this subsystem with finance stakeholders to
   resolve §5's open decisions.
2. Produce a design-complete spec from that pass.
3. Then writing-plans → phased implementation.

Do not begin implementation from this scoping document alone.
