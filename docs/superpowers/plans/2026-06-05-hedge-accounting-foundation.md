# Hedge Accounting Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hedge-accounting foundation required by the Window Forward accounting spec: schema, RLS, append-only ledgers, preparatory designation records, security-definer persistence RPCs, and first pure-TypeScript engine contracts.

**Architecture:** Start with a Supabase migration that creates the accounting configuration, designation, hedged item, period, fair-value, effectiveness, AOCI, and derivative carrying ledgers. Client writes to measurement/ledger tables are blocked; close flows persist through narrow SECURITY DEFINER RPCs so the eventual Edge Function can run TypeScript calculations and write validated rows. Pure TS modules will follow once the schema contract is pinned down.

**Tech Stack:** Supabase Postgres (PL/pgSQL, RLS, triggers), `node --test` static security regression tests, TypeScript/Vitest for pure accounting engine slices.

---

## File Structure

- `supabase/migrations/20260605000002_hedge_accounting_foundation.sql`: Creates Phase 1 tables, constraints, RLS policies, audit triggers, and locked persistence RPC stubs.
- `tests/security/hedge-accounting-foundation-regression.test.mjs`: Static migration regression tests for schema, append-only policies, RLS, audit, and final-output gating.
- `src/lib/hedgeAccounting/types.ts`: Shared domain types for later pure-TS close-engine functions.
- `src/lib/hedgeAccounting/types.test.ts`: Type/value tests for framework enums and status guards.

---

## Task 1: Accounting Foundation Migration

**Files:**
- Create: `tests/security/hedge-accounting-foundation-regression.test.mjs`
- Create: `supabase/migrations/20260605000002_hedge_accounting_foundation.sql`

- [ ] **Step 1: Write failing security regression tests**

Create `tests/security/hedge-accounting-foundation-regression.test.mjs` with tests that read `supabase/migrations/20260605000002_hedge_accounting_foundation.sql` and assert:

```javascript
assert.match(sql, /CREATE TABLE IF NOT EXISTS org_accounting_config/s)
assert.match(sql, /CREATE TABLE IF NOT EXISTS derivative_accounting_ledger/s)
assert.match(sql, /journal_output_mode\s+TEXT NOT NULL DEFAULT 'draft'/s)
assert.match(sql, /probability_status\s+TEXT NOT NULL DEFAULT 'probable'/s)
assert.match(sql, /no_longer_probable_still_expected/s)
assert.match(sql, /probable_not_to_occur/s)
assert.match(sql, /FOR INSERT TO authenticated WITH CHECK \(false\)/s)
assert.match(sql, /trg_audit_hedge_designations[\s\S]*audit_trigger_func\(\)/s)
assert.match(sql, /CREATE OR REPLACE FUNCTION record_designation/s)
assert.match(sql, /current_user_role\(\) NOT IN \('admin', 'editor'\)/s)
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
node --test tests/security/hedge-accounting-foundation-regression.test.mjs
```

Expected: FAIL because the migration file does not exist yet.

- [ ] **Step 3: Implement the migration**

Create `supabase/migrations/20260605000002_hedge_accounting_foundation.sql` with eight accounting tables, enum-like CHECK constraints, indexes, audit triggers for mutable business tables, append-only RLS policies for ledgers/measurements, and SECURITY DEFINER RPCs for `record_designation`, `append_fair_value_measurement`, `append_effectiveness_assessment`, `append_aoci_ledger_entry`, `append_derivative_accounting_entry`, and period status changes.

- [ ] **Step 4: Run the targeted security test**

Run:

```bash
node --test tests/security/hedge-accounting-foundation-regression.test.mjs
```

Expected: PASS.

---

## Task 2: Pure TypeScript Accounting Contracts

**Files:**
- Create: `src/lib/hedgeAccounting/types.test.ts`
- Create: `src/lib/hedgeAccounting/types.ts`

- [ ] **Step 1: Write failing TypeScript tests**

Create `src/lib/hedgeAccounting/types.test.ts` that imports enum arrays and status helpers from `types.ts`, then asserts ASC/IFRS frameworks, designation types, probability states, accounting statuses, and final-output gate inputs match the spec.

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
npm test -- src/lib/hedgeAccounting/types.test.ts
```

Expected: FAIL because `types.ts` does not exist.

- [ ] **Step 3: Implement minimal contracts**

Create `src/lib/hedgeAccounting/types.ts` with literal `as const` arrays, union types, `isFinalJournalAllowed()` and `isAccountingQualifiedDesignation()` helpers.

- [ ] **Step 4: Run the TypeScript test**

Run:

```bash
npm test -- src/lib/hedgeAccounting/types.test.ts
```

Expected: PASS.

---

## Task 3: Verification

**Files:**
- Existing test and migration files from Tasks 1-2.

- [ ] **Step 1: Run targeted tests**

```bash
node --test tests/security/hedge-accounting-foundation-regression.test.mjs
npm test -- src/lib/hedgeAccounting/types.test.ts
```

- [ ] **Step 2: Run broader safety checks if time allows**

```bash
npm run test:security
npm test
```

Expected: PASS, or report unrelated pre-existing failures separately.
