-- ============================================================
-- ORBIT: Switch RPC error strings to US spelling.
--
-- ~14 PL/pgSQL functions return RAISE EXCEPTION messages such as
-- "Organisation not found", "Cannot demote the last admin of
-- organisation %", etc. Those bubble up to the UI as error.message.
-- This migration finds every function in the public schema whose
-- source contains "Organisation" or "organisation" and re-creates it
-- with US spelling, while leaving identifiers we MUST keep alone:
--
--   - Table:    organisations              (DB schema, not visible)
--   - Triggers: trg_organisations_updated_at, trg_audit_organisations
--   - Function: delete_organisation()      (called via supabase.rpc())
--
-- Idempotent: re-running the migration on already-converted functions
-- is a no-op (the loop only executes when the rewrite produces a diff).
-- ============================================================

DO $$
DECLARE
  rec     RECORD;
  src     TEXT;
  new_src TEXT;
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ '[Oo]rganisation'
  LOOP
    src := pg_get_functiondef(rec.oid);
    new_src := src;

    -- Token-protect identifiers we must NOT rename. Order matters:
    -- the longest substrings get tokenized first so shorter matches
    -- inside them aren't disturbed.
    new_src := REPLACE(new_src, 'delete_organisation', '__KEEP_DELETE_ORG_FN__');
    new_src := REPLACE(new_src, 'organisations',       '__KEEP_ORGS_TABLE__');

    -- Apply US spelling everywhere else (error messages, comments).
    new_src := REPLACE(new_src, 'Organisations', 'Organizations');
    new_src := REPLACE(new_src, 'Organisation',  'Organization');
    new_src := REPLACE(new_src, 'organisation',  'organization');

    -- Restore the protected identifiers.
    new_src := REPLACE(new_src, '__KEEP_ORGS_TABLE__',     'organisations');
    new_src := REPLACE(new_src, '__KEEP_DELETE_ORG_FN__',  'delete_organisation');

    IF new_src <> src THEN
      EXECUTE new_src;
      RAISE NOTICE 'Updated function: %.%(...)', 'public', rec.proname;
    END IF;
  END LOOP;
END $$;
