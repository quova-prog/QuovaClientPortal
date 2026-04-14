-- ============================================================
-- ORBIT: SOC2 Mandatory Audit Triggers
-- Enforces server-side audit logging for critical tables.
-- ============================================================

CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_action TEXT;
  v_resource TEXT;
  v_resource_id TEXT;
  v_summary TEXT;
  v_metadata JSONB;
BEGIN
  v_resource := TG_TABLE_NAME;
  
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    IF v_resource = 'organisations' THEN
      v_org_id := NEW.id;
    ELSE
      v_org_id := NEW.org_id;
    END IF;
    v_resource_id := NEW.id::text;
    v_summary := 'Created ' || v_resource;
    v_metadata := jsonb_build_object('after', to_jsonb(NEW));
    
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    IF v_resource = 'organisations' THEN
      v_org_id := NEW.id;
    ELSE
      v_org_id := NEW.org_id;
    END IF;
    v_resource_id := NEW.id::text;
    v_summary := 'Updated ' || v_resource;
    v_metadata := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
    
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    IF v_resource = 'organisations' THEN
      v_org_id := OLD.id;
    ELSE
      v_org_id := OLD.org_id;
    END IF;
    v_resource_id := OLD.id::text;
    v_summary := 'Deleted ' || v_resource;
    v_metadata := jsonb_build_object('before', to_jsonb(OLD));
  END IF;

  -- The BEFORE INSERT trigger on audit_logs already intercepts this and populates
  -- user_id, user_email, and created_at using auth.uid().
  INSERT INTO audit_logs (org_id, action, resource, resource_id, summary, metadata)
  VALUES (v_org_id, v_action, v_resource, v_resource_id, v_summary, v_metadata);
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Apply triggers to core SOC2 tables
DROP TRIGGER IF EXISTS trg_audit_organisations ON organisations;
CREATE TRIGGER trg_audit_organisations
  AFTER INSERT OR UPDATE OR DELETE ON organisations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_fx_exposures ON fx_exposures;
CREATE TRIGGER trg_audit_fx_exposures
  AFTER INSERT OR UPDATE OR DELETE ON fx_exposures
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_hedge_positions ON hedge_positions;
CREATE TRIGGER trg_audit_hedge_positions
  AFTER INSERT OR UPDATE OR DELETE ON hedge_positions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_bank_accounts ON bank_accounts;
CREATE TRIGGER trg_audit_bank_accounts
  AFTER INSERT OR UPDATE OR DELETE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_entities ON entities;
CREATE TRIGGER trg_audit_entities
  AFTER INSERT OR UPDATE OR DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_profiles ON profiles;
CREATE TRIGGER trg_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_invites ON invites;
CREATE TRIGGER trg_audit_invites
  AFTER INSERT OR UPDATE OR DELETE ON invites
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
