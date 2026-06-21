-- =====================================================================
-- 0001 · Hand-authored objects from docs/schema.sql that Drizzle codegen
-- cannot express: plpgsql functions, constraint triggers, audit triggers,
-- and the restricted ledger_app role + GRANT/REVOKE.
-- 红线:一句不漏。改动前先核对铁律 3 / 铁律 5。
-- Each top-level statement is one `--> statement-breakpoint` chunk.
-- =====================================================================

-- ★ 铁律 3 · 防线 1 — posted 时强制 SUM(debit)=SUM(credit)(改 posted 凭证的行)
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS TRIGGER AS $$
DECLARE d NUMERIC; c NUMERIC; posted BOOLEAN;
BEGIN
    SELECT is_posted INTO posted FROM journal_entries
        WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
    IF posted THEN
        SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
            FROM journal_lines WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);
        IF d <> c THEN
            RAISE EXCEPTION 'Unbalanced entry %: debit % <> credit %',
                COALESCE(NEW.entry_id, OLD.entry_id), d, c;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_balanced
    AFTER INSERT OR UPDATE OR DELETE ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();
--> statement-breakpoint
-- ★ 铁律 3 · 防线 2 — 过账(is_posted false→true)时强制平衡 + 禁空凭证
-- 防止「只 UPDATE header 把不平草稿翻成 posted」绕过 lines 触发器
CREATE OR REPLACE FUNCTION assert_balanced_on_post() RETURNS TRIGGER AS $$
DECLARE d NUMERIC; c NUMERIC;
BEGIN
    IF NEW.is_posted AND (TG_OP = 'INSERT' OR NOT OLD.is_posted) THEN
        SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
            FROM journal_lines WHERE entry_id = NEW.id;
        IF d = 0 OR d <> c THEN
            RAISE EXCEPTION 'Cannot post unbalanced/empty entry %: debit % <> credit %',
                NEW.id, d, c;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_balanced_on_post
    AFTER INSERT OR UPDATE OF is_posted ON journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_balanced_on_post();
--> statement-breakpoint
-- ★ 铁律 5 — 审计写入由 SECURITY DEFINER 触发器自动写
-- 应用每事务开头注入:SET LOCAL app.user_id = '<uuid>'; SET LOCAL app.ip = '<addr>';
CREATE OR REPLACE FUNCTION write_audit() RETURNS TRIGGER
    SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID; v_id UUID; v_before JSONB; v_after JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_before := to_jsonb(OLD); v_after := NULL; v_org := OLD.org_id; v_id := OLD.id;
    ELSIF TG_OP = 'UPDATE' THEN
        v_before := to_jsonb(OLD); v_after := to_jsonb(NEW); v_org := NEW.org_id; v_id := NEW.id;
    ELSE
        v_before := NULL; v_after := to_jsonb(NEW); v_org := NEW.org_id; v_id := NEW.id;
    END IF;
    INSERT INTO audit_log(org_id, actor_user_id, action, entity, entity_id,
                          before_state, after_state, ip)
    VALUES (v_org,
            NULLIF(current_setting('app.user_id', true), '')::UUID,
            lower(TG_OP), TG_TABLE_NAME, v_id, v_before, v_after,
            NULLIF(current_setting('app.ip', true), '')::INET);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_audit_accounts AFTER INSERT OR UPDATE OR DELETE
    ON accounts        FOR EACH ROW EXECUTE FUNCTION write_audit();
--> statement-breakpoint
CREATE TRIGGER trg_audit_journal AFTER INSERT OR UPDATE OR DELETE
    ON journal_entries FOR EACH ROW EXECUTE FUNCTION write_audit();
--> statement-breakpoint
CREATE TRIGGER trg_audit_invoices AFTER INSERT OR UPDATE OR DELETE
    ON invoices        FOR EACH ROW EXECUTE FUNCTION write_audit();
--> statement-breakpoint
CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE OR DELETE
    ON payments        FOR EACH ROW EXECUTE FUNCTION write_audit();
--> statement-breakpoint
CREATE TRIGGER trg_audit_contacts AFTER INSERT OR UPDATE OR DELETE
    ON contacts        FOR EACH ROW EXECUTE FUNCTION write_audit();
--> statement-breakpoint
-- ★ 铁律 5 — 应用角色 ledger_app:audit_log 只读不可写改删
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_app') THEN
        CREATE ROLE ledger_app LOGIN;
    END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ledger_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
--> statement-breakpoint
-- audit_log 例外:红线
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM ledger_app;
--> statement-breakpoint
GRANT SELECT ON audit_log TO ledger_app;
