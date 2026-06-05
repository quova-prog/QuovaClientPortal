# Window Forwards — Phase 1 (Schema & RPC Invariants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the database foundation for window forwards — schema, constraints, draw ledger with stored economics, exposure-allocation linkage, policy controls, invariant triggers, RLS, and audit coverage — with static security-regression tests as the TDD gate. No UI, no booking/draw RPCs (those are Phase 2).

**Architecture:** Five idempotent SQL migrations extend `hedge_positions`, add `hedge_position_draws` (with write-once economics) and `draw_exposure_allocations`, extend `hedge_policies`, and add a `validate_window_forward()` policy-check function. Invariants are enforced at the table level (CHECK constraints + BEFORE/AFTER triggers) so they hold even under concurrency and cannot be bypassed by direct client writes (RLS `WITH CHECK (false)` makes the Phase-2 SECURITY DEFINER RPCs the only write path). Each migration is paired with a static source-assertion test in the repo's existing `tests/security/*.test.mjs` style (regex over the migration file — no live DB needed for the test loop).

**Tech Stack:** Supabase Postgres (PL/pgSQL, RLS, triggers), `node --test` for static security regressions, `supabase` CLI for applying migrations + regenerating `database.types.ts`.

**Phase boundary:** This phase delivers the data layer and the `validate_window_forward()` invariant function. The booking path (`book_hedge_position` window branch), the draw RPC with server-computed economics (`record_window_draw`), and the end-of-window settlement job (`settle_expired_windows`) are **Phase 2** — they call the invariants built here. `draw_rate` authority (server sets it from `contracted_rate`) is enforced inside the Phase-2 RPC; Phase 1 provides the columns and policy checks it will use.

**Migration ordering:** Latest existing migration is `20260506_*`. New files use the `20260604000001…05` prefix so they apply in order, after everything currently in `supabase/migrations/`.

**Reused existing primitives (do not redefine):**
- `current_user_org_id()` — returns caller's org, requires AAL2 (from `20260415_aal2_enforcement.sql`).
- `current_user_role()` — returns caller's role.
- `audit_trigger_func()` — generic SECURITY DEFINER audit trigger (from `20260414_mandatory_audit_triggers.sql`).
- `organisations`, `hedge_positions`, `hedge_policies`, `fx_exposures`, `profiles` — existing tables.
- `hedge_positions.status` already permits `active | expired | cancelled | rolled | closed` (from `20260411_hedge_lifecycle.sql`).
- `hedge_policies.allowed_instruments TEXT[]` already exists, **nullable** (from `20260330_hedge_policy_v2.sql`).

---

## Task 1: Migration A — extend `hedge_positions`

**Files:**
- Create: `supabase/migrations/20260604000001_window_forward_positions.sql`
- Create: `tests/security/window-forward-regression.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/security/window-forward-regression.test.mjs`:

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

test('Migration A: hedge_positions allows window_forward and adds window columns', () => {
  const sql = read('supabase/migrations/20260604000001_window_forward_positions.sql')

  // instrument_type CHECK now includes window_forward
  assert.match(sql, /instrument_type IN \(\s*'forward',\s*'window_forward',\s*'swap',\s*'option',\s*'spot'\s*\)/s)

  // new columns, added idempotently
  assert.match(sql, /ADD COLUMN IF NOT EXISTS window_start_date\s+DATE/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS window_end_date\s+DATE/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pricing_method\s+TEXT/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS drawn_notional\s+NUMERIC\(20,2\) NOT NULL DEFAULT 0/s)

  // consistency CHECK: window fields present iff window_forward, with valid pricing_method
  assert.match(sql, /window_dates_consistent/s)
  assert.match(sql, /pricing_method\s+IN \('fixed_worst_rate','pro_rata_points'\)/s)

  // drawn_notional bounded to [0, notional_base]
  assert.match(sql, /drawn_notional >= 0 AND drawn_notional <= notional_base/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: FAIL — `ENOENT` opening the not-yet-created migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260604000001_window_forward_positions.sql`:

```sql
-- ============================================================
-- Window Forwards — Phase 1 Migration A
-- Extend hedge_positions to support window_forward as a first-class
-- instrument. Idempotent: coexists with 20260330_hedge_policy_v2.sql
-- and 20260411_hedge_lifecycle.sql.
-- ============================================================

-- 1. Allow the new instrument type.
ALTER TABLE hedge_positions
  DROP CONSTRAINT IF EXISTS hedge_positions_instrument_type_check;
ALTER TABLE hedge_positions
  ADD CONSTRAINT hedge_positions_instrument_type_check
  CHECK (instrument_type IN ('forward', 'window_forward', 'swap', 'option', 'spot'));

-- 2. Window-specific columns (nullable for non-window instruments).
ALTER TABLE hedge_positions
  ADD COLUMN IF NOT EXISTS window_start_date DATE,
  ADD COLUMN IF NOT EXISTS window_end_date   DATE,
  ADD COLUMN IF NOT EXISTS pricing_method    TEXT,
  ADD COLUMN IF NOT EXISTS drawn_notional    NUMERIC(20,2) NOT NULL DEFAULT 0;

-- 3. Window fields are present iff the instrument is a window forward,
--    and pricing_method must be a known variant.
DO $$ BEGIN
  ALTER TABLE hedge_positions ADD CONSTRAINT window_dates_consistent CHECK (
    (instrument_type = 'window_forward'
       AND window_start_date IS NOT NULL
       AND window_end_date   IS NOT NULL
       AND window_end_date >= window_start_date
       AND pricing_method  IN ('fixed_worst_rate','pro_rata_points'))
    OR (instrument_type <> 'window_forward'
       AND window_start_date IS NULL
       AND window_end_date   IS NULL
       AND pricing_method    IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. drawn_notional is trigger-maintained (Migration B) and bounded.
DO $$ BEGIN
  ALTER TABLE hedge_positions ADD CONSTRAINT drawn_notional_bounded
    CHECK (drawn_notional >= 0 AND drawn_notional <= notional_base);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604000001_window_forward_positions.sql tests/security/window-forward-regression.test.mjs
git commit -m "feat(wf): Migration A — hedge_positions window_forward columns + constraints"
```

---

## Task 2: Migration B — `hedge_position_draws` (economics + recalc + org-match + audit + RLS)

**Files:**
- Create: `supabase/migrations/20260604000002_window_forward_draws.sql`
- Modify: `tests/security/window-forward-regression.test.mjs` (append a test)

- [ ] **Step 1: Write the failing test (append to the file)**

Append to `tests/security/window-forward-regression.test.mjs`:

```javascript
test('Migration B: draws table stores write-once economics with invariant triggers + RLS', () => {
  const sql = read('supabase/migrations/20260604000002_window_forward_draws.sql')

  // table + write-once economic columns
  assert.match(sql, /CREATE TABLE IF NOT EXISTS hedge_position_draws/s)
  for (const col of [
    'spot_rate_at_draw', 'settlement_quote', 'realized_pnl_quote',
    'realized_pnl_usd', 'is_final_settlement', 'draw_seq',
  ]) {
    assert.match(sql, new RegExp(col, 's'), `missing column ${col}`)
  }

  // unique draw sequence per position
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_draw_seq\s+ON hedge_position_draws\(position_id, draw_seq\)/s)

  // org-match trigger: draw.org_id must equal parent position org
  assert.match(sql, /enforce_draw_org_matches_position/s)
  assert.match(sql, /does not match position org/s)
  assert.match(sql, /BEFORE INSERT OR UPDATE ON hedge_position_draws/s)

  // recalc trigger locks the parent row (FOR UPDATE) and auto-closes when fully drawn
  assert.match(sql, /recalc_drawn_notional/s)
  assert.match(sql, /FROM hedge_positions WHERE id = v_pos FOR UPDATE/s)
  assert.match(sql, /WHEN v_total >= v_notional THEN 'closed'/s)

  // mandatory audit trigger
  assert.match(sql, /trg_audit_hedge_position_draws[\s\S]*audit_trigger_func\(\)/s)

  // RLS: select scoped to org; direct writes blocked (RPC is the only write path)
  assert.match(sql, /ALTER TABLE hedge_position_draws ENABLE ROW LEVEL SECURITY/s)
  assert.match(sql, /FOR SELECT USING \(org_id = current_user_org_id\(\)\)/s)
  assert.match(sql, /FOR INSERT TO authenticated WITH CHECK \(false\)/s)
  assert.match(sql, /FOR UPDATE TO authenticated USING \(false\)/s)
  assert.match(sql, /FOR DELETE TO authenticated USING \(false\)/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: FAIL — `ENOENT` for Migration B (Task 1's test still passes).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260604000002_window_forward_draws.sql`:

```sql
-- ============================================================
-- Window Forwards — Phase 1 Migration B
-- Draw ledger with write-once economics, org-match + recalc/auto-close
-- triggers (concurrency-safe via parent FOR UPDATE lock), mandatory
-- audit coverage, and RLS that makes the Phase-2 RPC the only write path.
-- ============================================================

CREATE TABLE IF NOT EXISTS hedge_position_draws (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  position_id         UUID NOT NULL REFERENCES hedge_positions(id) ON DELETE CASCADE,
  draw_seq            INTEGER NOT NULL,
  draw_date           DATE    NOT NULL,
  draw_amount         NUMERIC(20,2) NOT NULL CHECK (draw_amount > 0),
  draw_rate           NUMERIC(20,8) NOT NULL,
  spot_rate_at_draw   NUMERIC(20,8) NOT NULL,
  settlement_quote    NUMERIC(20,2) NOT NULL,
  realized_pnl_quote  NUMERIC(20,2) NOT NULL,
  realized_pnl_usd    NUMERIC(20,2) NOT NULL,
  is_final_settlement BOOLEAN NOT NULL DEFAULT FALSE,
  bank_confirmation   TEXT,
  reference_number    TEXT,
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_draw_seq  ON hedge_position_draws(position_id, draw_seq);
CREATE INDEX IF NOT EXISTS idx_draws_position  ON hedge_position_draws(position_id);
CREATE INDEX IF NOT EXISTS idx_draws_org_date  ON hedge_position_draws(org_id, draw_date);

-- Org-match: a draw's org must equal its parent position's org.
CREATE OR REPLACE FUNCTION enforce_draw_org_matches_position()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pos_org UUID;
BEGIN
  SELECT org_id INTO v_pos_org FROM hedge_positions WHERE id = NEW.position_id;
  IF v_pos_org IS NULL THEN
    RAISE EXCEPTION 'hedge_position_draws: parent position % not found', NEW.position_id;
  END IF;
  IF NEW.org_id <> v_pos_org THEN
    RAISE EXCEPTION 'hedge_position_draws: org_id % does not match position org %',
      NEW.org_id, v_pos_org;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_draw_org_match ON hedge_position_draws;
CREATE TRIGGER trg_draw_org_match
  BEFORE INSERT OR UPDATE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION enforce_draw_org_matches_position();

-- Recalc drawn_notional + auto-close. Parent FOR UPDATE lock serializes
-- concurrent draws so the notional/close invariant holds under load.
CREATE OR REPLACE FUNCTION recalc_drawn_notional()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC(20,2); v_notional NUMERIC(20,2); v_pos UUID;
BEGIN
  v_pos := COALESCE(NEW.position_id, OLD.position_id);
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

DROP TRIGGER IF EXISTS trg_draws_recalc_notional ON hedge_position_draws;
CREATE TRIGGER trg_draws_recalc_notional
  AFTER INSERT OR UPDATE OR DELETE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION recalc_drawn_notional();

-- Mandatory audit (session-14 pattern).
DROP TRIGGER IF EXISTS trg_audit_hedge_position_draws ON hedge_position_draws;
CREATE TRIGGER trg_audit_hedge_position_draws
  AFTER INSERT OR UPDATE OR DELETE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- RLS: org-scoped read; all direct writes blocked. The Phase-2
-- record_window_draw() RPC is SECURITY DEFINER and bypasses RLS, so it
-- remains the single write path.
ALTER TABLE hedge_position_draws ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "draws_select_org" ON hedge_position_draws;
CREATE POLICY "draws_select_org" ON hedge_position_draws
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "draws_no_direct_insert" ON hedge_position_draws;
CREATE POLICY "draws_no_direct_insert" ON hedge_position_draws
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "draws_no_direct_update" ON hedge_position_draws;
CREATE POLICY "draws_no_direct_update" ON hedge_position_draws
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "draws_no_direct_delete" ON hedge_position_draws;
CREATE POLICY "draws_no_direct_delete" ON hedge_position_draws
  FOR DELETE TO authenticated USING (false);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604000002_window_forward_draws.sql tests/security/window-forward-regression.test.mjs
git commit -m "feat(wf): Migration B — draw ledger with economics, invariant triggers, RLS"
```

---

## Task 3: Migration C — `draw_exposure_allocations` + `fx_exposures.settled_amount`

**Files:**
- Create: `supabase/migrations/20260604000003_draw_exposure_allocations.sql`
- Modify: `tests/security/window-forward-regression.test.mjs` (append a test)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('Migration C: draw→exposure allocation linkage + settled_amount on fx_exposures', () => {
  const sql = read('supabase/migrations/20260604000003_draw_exposure_allocations.sql')

  // fx_exposures gains a bounded settled_amount
  assert.match(sql, /ALTER TABLE fx_exposures[\s\S]*ADD COLUMN IF NOT EXISTS settled_amount\s+NUMERIC\(20,2\) NOT NULL DEFAULT 0/s)
  assert.match(sql, /settled_amount >= 0 AND settled_amount <= notional_base/s)

  // allocation table with exactly-one-target invariant
  assert.match(sql, /CREATE TABLE IF NOT EXISTS draw_exposure_allocations/s)
  assert.match(sql, /one_target CHECK/s)
  assert.match(sql, /exposure_id IS NOT NULL AND derived_source IS NULL/s)
  assert.match(sql, /exposure_id IS NULL AND derived_source IS NOT NULL/s)

  // audit + RLS (read-only to clients; RPC is the write path)
  assert.match(sql, /trg_audit_draw_exposure_allocations[\s\S]*audit_trigger_func\(\)/s)
  assert.match(sql, /ALTER TABLE draw_exposure_allocations ENABLE ROW LEVEL SECURITY/s)
  assert.match(sql, /FOR SELECT USING \(org_id = current_user_org_id\(\)\)/s)
  assert.match(sql, /FOR INSERT TO authenticated WITH CHECK \(false\)/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: FAIL — `ENOENT` for Migration C.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260604000003_draw_exposure_allocations.sql`:

```sql
-- ============================================================
-- Window Forwards — Phase 1 Migration C
-- Link draws to the underlying exposures they settle so coverage and
-- exposure fall together. Adds fx_exposures.settled_amount and a
-- draw_exposure_allocations table (allocate a draw to a DB exposure row
-- OR a derived-source reference, never both).
-- ============================================================

ALTER TABLE fx_exposures
  ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(20,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE fx_exposures ADD CONSTRAINT fx_exposures_settled_bounded
    CHECK (settled_amount >= 0 AND settled_amount <= notional_base);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS draw_exposure_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  draw_id          UUID NOT NULL REFERENCES hedge_position_draws(id) ON DELETE CASCADE,
  exposure_id      UUID REFERENCES fx_exposures(id) ON DELETE SET NULL,
  derived_source   TEXT,
  derived_ref      TEXT,
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_target CHECK (
    (exposure_id IS NOT NULL AND derived_source IS NULL)
    OR (exposure_id IS NULL AND derived_source IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_alloc_draw     ON draw_exposure_allocations(draw_id);
CREATE INDEX IF NOT EXISTS idx_alloc_exposure ON draw_exposure_allocations(exposure_id);

DROP TRIGGER IF EXISTS trg_audit_draw_exposure_allocations ON draw_exposure_allocations;
CREATE TRIGGER trg_audit_draw_exposure_allocations
  AFTER INSERT OR UPDATE OR DELETE ON draw_exposure_allocations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

ALTER TABLE draw_exposure_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alloc_select_org" ON draw_exposure_allocations;
CREATE POLICY "alloc_select_org" ON draw_exposure_allocations
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "alloc_no_direct_insert" ON draw_exposure_allocations;
CREATE POLICY "alloc_no_direct_insert" ON draw_exposure_allocations
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "alloc_no_direct_update" ON draw_exposure_allocations;
CREATE POLICY "alloc_no_direct_update" ON draw_exposure_allocations
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "alloc_no_direct_delete" ON draw_exposure_allocations;
CREATE POLICY "alloc_no_direct_delete" ON draw_exposure_allocations
  FOR DELETE TO authenticated USING (false);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604000003_draw_exposure_allocations.sql tests/security/window-forward-regression.test.mjs
git commit -m "feat(wf): Migration C — draw→exposure allocation linkage + settled_amount"
```

---

## Task 4: Migration D — `hedge_policies` window controls + audit coverage

**Files:**
- Create: `supabase/migrations/20260604000004_window_forward_policy.sql`
- Modify: `tests/security/window-forward-regression.test.mjs` (append a test)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('Migration D: policy window controls (idempotent) + hedge_policies audit coverage', () => {
  const sql = read('supabase/migrations/20260604000004_window_forward_policy.sql')

  // new policy columns added idempotently (allowed_instruments already exists from v2)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS window_forward_pairs\s+TEXT\[\] NOT NULL DEFAULT '\{\}'::TEXT\[\]/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS max_window_days\s+INTEGER NOT NULL DEFAULT 90/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS max_draws_per_window\s+INTEGER NOT NULL DEFAULT 8/s)

  // bounded
  assert.match(sql, /max_window_days > 0 AND max_window_days <= 365/s)
  assert.match(sql, /max_draws_per_window > 0 AND max_draws_per_window <= 50/s)

  // careful backfill: NULL allowed_instruments → classic four, NEVER auto-enable window_forward
  assert.match(sql, /SET allowed_instruments = ARRAY\['forward','swap','option','spot'\]::TEXT\[\]\s*WHERE allowed_instruments IS NULL/s)
  assert.doesNotMatch(sql, /allowed_instruments[\s\S]*'window_forward'/s)

  // hedge_policies now audit-covered (compliance-sensitive allowlist)
  assert.match(sql, /trg_audit_hedge_policies[\s\S]*audit_trigger_func\(\)/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: FAIL — `ENOENT` for Migration D.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260604000004_window_forward_policy.sql`:

```sql
-- ============================================================
-- Window Forwards — Phase 1 Migration D
-- Policy controls for window forwards. allowed_instruments already
-- exists (nullable) from 20260330_hedge_policy_v2.sql, so this only adds
-- the missing columns, backfills carefully, and adds hedge_policies to
-- the mandatory audit trigger (the allowlist is compliance-sensitive).
-- ============================================================

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

-- Backfill NULL allowed_instruments with the classic four. Window forwards
-- are explicit opt-in and are NEVER enabled by migration.
UPDATE hedge_policies
  SET allowed_instruments = ARRAY['forward','swap','option','spot']::TEXT[]
  WHERE allowed_instruments IS NULL;

-- Audit policy changes (no separate policy_versions table exists; the
-- mandatory audit trigger is the version history).
DROP TRIGGER IF EXISTS trg_audit_hedge_policies ON hedge_policies;
CREATE TRIGGER trg_audit_hedge_policies
  AFTER INSERT OR UPDATE OR DELETE ON hedge_policies
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604000004_window_forward_policy.sql tests/security/window-forward-regression.test.mjs
git commit -m "feat(wf): Migration D — policy window controls + hedge_policies audit coverage"
```

---

## Task 5: Migration E — `validate_window_forward()` policy-check function

**Files:**
- Create: `supabase/migrations/20260604000005_window_forward_validation.sql`
- Modify: `tests/security/window-forward-regression.test.mjs` (append a test)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('Migration E: validate_window_forward enforces policy invariants server-side', () => {
  const sql = read('supabase/migrations/20260604000005_window_forward_validation.sql')

  assert.match(sql, /CREATE OR REPLACE FUNCTION validate_window_forward/s)
  // SECURITY DEFINER with locked search_path (SOC2 requirement)
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = public/s)

  // each policy gate raises rather than silently passing
  assert.match(sql, /Policy does not allow window forwards/s)
  assert.match(sql, /not eligible for window forwards under policy/s)
  assert.match(sql, /exceeds policy max/s)
  assert.match(sql, /Max draws per window/s)

  // uses array membership against the policy controls from Migration D
  assert.match(sql, /'window_forward' = ANY\(/s)
  assert.match(sql, /= ANY\(COALESCE\(v_policy\.window_forward_pairs/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: FAIL — `ENOENT` for Migration E.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260604000005_window_forward_validation.sql`:

```sql
-- ============================================================
-- Window Forwards — Phase 1 Migration E
-- Server-side policy validation used by the Phase-2 booking/draw RPCs.
-- Fail-closed: any breach raises an exception. Run as SECURITY DEFINER
-- with a locked search_path so it reads policy state authoritatively.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_window_forward(
  p_org_id        UUID,
  p_currency_pair TEXT,
  p_window_start  DATE,
  p_window_end    DATE,
  p_notional      NUMERIC,
  p_position_id   UUID DEFAULT NULL   -- set when validating an additional draw
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy     hedge_policies%ROWTYPE;
  v_span_days  INTEGER;
  v_draw_count INTEGER;
BEGIN
  SELECT * INTO v_policy FROM hedge_policies
    WHERE org_id = p_org_id AND active = TRUE
    ORDER BY entity_id NULLS LAST
    LIMIT 1;

  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'No active hedge policy for org %', p_org_id;
  END IF;

  IF NOT ('window_forward' = ANY(COALESCE(v_policy.allowed_instruments, '{}'))) THEN
    RAISE EXCEPTION 'Policy does not allow window forwards';
  END IF;

  IF NOT (p_currency_pair = ANY(COALESCE(v_policy.window_forward_pairs, '{}'))) THEN
    RAISE EXCEPTION 'Currency pair % not eligible for window forwards under policy', p_currency_pair;
  END IF;

  IF p_window_end < p_window_start THEN
    RAISE EXCEPTION 'Window end precedes window start';
  END IF;

  v_span_days := (p_window_end - p_window_start);
  IF v_span_days > v_policy.max_window_days THEN
    RAISE EXCEPTION 'Window span % days exceeds policy max %', v_span_days, v_policy.max_window_days;
  END IF;

  -- When validating an additional draw, enforce the per-window draw cap.
  IF p_position_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_draw_count
      FROM hedge_position_draws WHERE position_id = p_position_id;
    IF v_draw_count >= v_policy.max_draws_per_window THEN
      RAISE EXCEPTION 'Max draws per window (%) reached', v_policy.max_draws_per_window;
    END IF;
  END IF;
END $$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/security/window-forward-regression.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604000005_window_forward_validation.sql tests/security/window-forward-regression.test.mjs
git commit -m "feat(wf): Migration E — validate_window_forward policy-check function"
```

---

## Task 6: Apply migrations, regenerate types, run full suite

**Files:**
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Apply the five migrations to the linked project**

Run (targets the orbit-mvp project explicitly, consistent with this repo's deploy convention):

```bash
supabase db push --linked --include-all
```

Expected: the five `20260604000001…05` migrations apply cleanly. If `--linked` prompts for the project, confirm it is `vmtwojalyzvmdpldgabi` (orbit-mvp) — NOT any other project.

> If `supabase db push` is not the workflow in use, apply each migration's SQL via the
> Supabase dashboard SQL editor for project `vmtwojalyzvmdpldgabi` in filename order.
> The DDL is trigger-only and does not insert rows, so the mandatory-audit
> `authenticated user required` guard does not block it.

- [ ] **Step 2: Regenerate the typed schema**

Run: `SUPABASE_AUTO_UPDATE_NOTIFIER=false npm run types:db`
Expected: `src/types/database.types.ts` updates to include `hedge_position_draws`,
`draw_exposure_allocations`, the new `hedge_positions` / `hedge_policies` columns, and the
`validate_window_forward` function signature.

- [ ] **Step 3: Verify the type file is valid TypeScript**

Run: `npx tsc -p . --noEmit`
Expected: no errors (clean exit).

- [ ] **Step 4: Run the full test suite**

Run: `npm run test:security && npm test`
Expected: all security regressions pass (including the 5 new window-forward tests) and all
vitest unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/database.types.ts
git commit -m "feat(wf): apply Phase 1 window-forward migrations + regenerate DB types"
```

---

## Self-Review

**Spec coverage (Phase 1 items from §3 + §9.1 of the design spec):**
- Migration A (hedge_positions window columns + CHECKs) → Task 1 ✓
- Migration B (draws table, write-once economics, recalc/auto-close, parent lock) → Task 2 ✓
- Org-match invariant trigger → Task 2 ✓
- Migration C (draw_exposure_allocations + fx_exposures.settled_amount) → Task 3 ✓
- Migration D (hedge_policies window controls, idempotent, careful backfill) → Task 4 ✓
- hedge_policies audit-trigger extension → Task 4 ✓
- draws + allocations audit-trigger coverage → Tasks 2, 3 ✓
- RLS (org read, no direct writes) on both new tables → Tasks 2, 3 ✓
- validate_window_forward() policy checks → Task 5 ✓
- Security regression tests → Tasks 1–5 (one assertion block each) ✓
- Apply + types regen + suite → Task 6 ✓

**Deferred to later phases (correctly not in this plan):** booking/draw RPCs with
server-computed economics + draw_rate authority + business-day check (Phase 2),
end-of-window settlement job (Phase 2), tierService gate + UI (Phase 5), coverage helper
+ view edit (Phase 3), MTM module (Phase 4). These appear in the spec's §9 sequence and
will get their own plans.

**Placeholder scan:** none — every step has complete SQL/test code and exact commands.

**Type/name consistency:** `validate_window_forward` (5 args + optional `p_position_id`),
`recalc_drawn_notional`, `enforce_draw_org_matches_position`, `hedge_position_draws`,
`draw_exposure_allocations`, `window_forward_pairs`, `max_window_days`,
`max_draws_per_window`, `drawn_notional`, `settled_amount` — all referenced consistently
across tasks and tests. Trigger names (`trg_draw_org_match`, `trg_draws_recalc_notional`,
`trg_audit_hedge_position_draws`, `trg_audit_draw_exposure_allocations`,
`trg_audit_hedge_policies`) are unique and match between migration and test.
