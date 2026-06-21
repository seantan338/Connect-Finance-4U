-- =====================================================================
-- LEDGER PROJECT — Core Accounting Schema (PostgreSQL 15+)
-- v0.1  | Phase 0 deliverable
-- 设计原则:financial truth 全部落在 Postgres(ACID),Firebase 只管
--          auth / 实时协作 / app 状态。绝不把 ledger 放 Firestore。
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. TENANCY / MULTI-ENTITY  (修:多公司不灵活)
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legal_name      TEXT NOT NULL,
    brn             TEXT,                       -- SSM business reg no
    tin             TEXT,                       -- LHDN tax id (e-Invoice 必填)
    sst_no          TEXT,
    base_currency   CHAR(3) NOT NULL DEFAULT 'MYR',
    country         CHAR(2) NOT NULL DEFAULT 'MY',
    parent_org_id   UUID REFERENCES organizations(id),  -- 集团合并用
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid    TEXT UNIQUE NOT NULL,        -- 桥接 Firebase Auth
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 细粒度 RBAC (修:权限粗糙)
CREATE TABLE memberships (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    user_id         UUID NOT NULL REFERENCES app_users(id),
    role            TEXT NOT NULL CHECK (role IN
                    ('owner','admin','accountant','clerk','viewer')),
    UNIQUE (org_id, user_id)
);

-- ---------------------------------------------------------------------
-- 2. CURRENCY  (修:多币种不灵活)
-- ---------------------------------------------------------------------
CREATE TABLE currencies (
    code            CHAR(3) PRIMARY KEY,         -- ISO 4217
    name            TEXT NOT NULL,
    minor_unit      SMALLINT NOT NULL DEFAULT 2
);

CREATE TABLE exchange_rates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    from_ccy        CHAR(3) NOT NULL REFERENCES currencies(code),
    to_ccy          CHAR(3) NOT NULL REFERENCES currencies(code),
    rate            NUMERIC(20,10) NOT NULL,
    rate_date       DATE NOT NULL,
    UNIQUE (org_id, from_ccy, to_ccy, rate_date)
);

-- ---------------------------------------------------------------------
-- 3. CHART OF ACCOUNTS  (修:本地化报表非原生 / 科目层级)
-- ---------------------------------------------------------------------
CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,               -- e.g. '1000'
    name            TEXT NOT NULL,
    account_type    TEXT NOT NULL CHECK (account_type IN
                    ('asset','liability','equity','income','expense')),
    -- 借增/贷增方向:asset/expense=debit,其余=credit
    normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
    parent_id       UUID REFERENCES accounts(id),  -- 科目层级
    is_active       BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (org_id, code)
);

-- ---------------------------------------------------------------------
-- 4. FISCAL PERIOD / CLOSE  (修:期间管理弱)
-- ---------------------------------------------------------------------
CREATE TABLE fiscal_periods (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed','locked')),
    UNIQUE (org_id, period_start)
);

-- ---------------------------------------------------------------------
-- 5. DOUBLE-ENTRY CORE  ★★★ 这块错了全盘重来 ★★★
-- journal_entries = 凭证头;journal_lines = 借贷分录行
-- 不变式:每张凭证 SUM(debit) = SUM(credit),由 trigger 强制
-- ---------------------------------------------------------------------
CREATE TABLE journal_entries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    entry_no        BIGINT NOT NULL,             -- 每个 org 连续编号
    entry_date      DATE NOT NULL,
    period_id       UUID NOT NULL REFERENCES fiscal_periods(id),
    memo            TEXT,
    source          TEXT NOT NULL DEFAULT 'manual'  -- manual/invoice/payment/bank
                    CHECK (source IN ('manual','invoice','payment','bank','system')),
    source_id       UUID,                        -- 指向 invoices/payments 等
    is_posted       BOOLEAN NOT NULL DEFAULT false,  -- draft vs posted
    created_by      UUID NOT NULL REFERENCES app_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, entry_no)
);

CREATE TABLE journal_lines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_id        UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id),
    -- 一行只能是借或贷之一,另一为 0
    debit           NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
    credit          NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    currency        CHAR(3) NOT NULL REFERENCES currencies(code),
    fx_rate         NUMERIC(20,10) NOT NULL DEFAULT 1,
    -- base currency 金额(用于合并报表),= (debit-credit)*fx_rate
    base_amount     NUMERIC(20,4) NOT NULL,
    line_memo       TEXT,
    CHECK (NOT (debit > 0 AND credit > 0))       -- 不能同时借贷
);

CREATE INDEX idx_lines_entry   ON journal_lines(entry_id);
CREATE INDEX idx_lines_account ON journal_lines(account_id);
CREATE INDEX idx_entries_org_date ON journal_entries(org_id, entry_date);

-- ★ 平衡校验:posted 时强制 SUM(debit)=SUM(credit)
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

CREATE CONSTRAINT TRIGGER trg_balanced
    AFTER INSERT OR UPDATE OR DELETE ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- ★ 第二道 DB 防线:过账(is_posted false→true)时强制平衡 + 禁空凭证
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

CREATE CONSTRAINT TRIGGER trg_balanced_on_post
    AFTER INSERT OR UPDATE OF is_posted ON journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_balanced_on_post();

-- ---------------------------------------------------------------------
-- 6. CONTACTS / INVOICING  (修:开票合规 + 流程割裂)
-- ---------------------------------------------------------------------
CREATE TABLE contacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    kind            TEXT NOT NULL CHECK (kind IN ('customer','supplier','both')),
    name            TEXT NOT NULL,
    tin             TEXT,                        -- e-Invoice 对手方必填
    brn             TEXT,
    sst_no          TEXT,
    email           TEXT,
    address         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tax_codes (                          -- SST
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,               -- e.g. 'SST-6', 'SST-0'
    rate            NUMERIC(6,4) NOT NULL,
    UNIQUE (org_id, code)
);

CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    direction       TEXT NOT NULL CHECK (direction IN ('sales','purchase')),
    doc_type        TEXT NOT NULL DEFAULT 'invoice'
                    CHECK (doc_type IN ('invoice','credit_note','debit_note','self_billed')),
    invoice_no      TEXT NOT NULL,
    contact_id      UUID NOT NULL REFERENCES contacts(id),
    issue_date      DATE NOT NULL,
    currency        CHAR(3) NOT NULL REFERENCES currencies(code),
    subtotal        NUMERIC(20,4) NOT NULL DEFAULT 0,
    tax_total       NUMERIC(20,4) NOT NULL DEFAULT 0,
    grand_total     NUMERIC(20,4) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','issued','paid','void')),
    journal_entry_id UUID REFERENCES journal_entries(id),  -- 过账后回填
    UNIQUE (org_id, invoice_no)
);

CREATE TABLE invoice_lines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description     TEXT NOT NULL,
    classification  TEXT,                        -- MyInvois 产品分类码
    qty             NUMERIC(20,4) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(20,4) NOT NULL,
    account_id      UUID NOT NULL REFERENCES accounts(id),  -- 收入/费用科目
    tax_code_id     UUID REFERENCES tax_codes(id),
    line_total      NUMERIC(20,4) NOT NULL
);

-- ---------------------------------------------------------------------
-- 7. E-INVOICE / MyInvois  (修:e-Invoice 靠插件 → 原生内置)
-- 记录每次向 MyInvois 的提交、UUID、状态、validation 结果
-- ---------------------------------------------------------------------
CREATE TABLE einvoice_submissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    myinvois_uuid   TEXT,                        -- LHDN 回传的 UUID
    submission_uid  TEXT,
    channel         TEXT NOT NULL DEFAULT 'api'  -- api / peppol
                    CHECK (channel IN ('api','peppol')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','valid','invalid','cancelled','rejected')),
    payload         JSONB NOT NULL,              -- 提交的 55 字段结构
    validation      JSONB,                       -- LHDN validation 返回
    qr_url          TEXT,
    digital_sig     TEXT,
    submitted_at    TIMESTAMPTZ,
    validated_at    TIMESTAMPTZ
);

CREATE INDEX idx_einv_invoice ON einvoice_submissions(invoice_id);

-- ---------------------------------------------------------------------
-- 8. PAYMENTS  (收付款 + 核销)
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    contact_id      UUID NOT NULL REFERENCES contacts(id),
    amount          NUMERIC(20,4) NOT NULL,
    currency        CHAR(3) NOT NULL REFERENCES currencies(code),
    pay_date        DATE NOT NULL,
    method          TEXT,
    journal_entry_id UUID REFERENCES journal_entries(id)
);

CREATE TABLE payment_allocations (                -- 一笔款核销多张发票
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id      UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    amount          NUMERIC(20,4) NOT NULL
);

-- ---------------------------------------------------------------------
-- 9. IMMUTABLE AUDIT TRAIL  (修:留痕/合规 → PDPA 留存)
-- append-only;不开 UPDATE/DELETE 权限给应用角色
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id          UUID NOT NULL,
    actor_user_id   UUID,
    action          TEXT NOT NULL,               -- create/update/post/void...
    entity          TEXT NOT NULL,               -- table name
    entity_id       UUID,
    before_state    JSONB,
    after_state     JSONB,
    ip              INET,
    at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org_at ON audit_log(org_id, at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

-- ★ 审计写入机制:由 SECURITY DEFINER 触发器自动写,应用角色连 INSERT 都不需要
-- 应用在每个事务开头注入上下文:
--   SET LOCAL app.user_id = '<uuid>';  SET LOCAL app.ip = '<addr>';
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

-- 挂到 org-scoped 业务表(journal_lines 的变动由 journal_entries 层覆盖)
CREATE TRIGGER trg_audit_accounts AFTER INSERT OR UPDATE OR DELETE
    ON accounts        FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER trg_audit_journal AFTER INSERT OR UPDATE OR DELETE
    ON journal_entries FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER trg_audit_invoices AFTER INSERT OR UPDATE OR DELETE
    ON invoices        FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE OR DELETE
    ON payments        FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER trg_audit_contacts AFTER INSERT OR UPDATE OR DELETE
    ON contacts        FOR EACH ROW EXECUTE FUNCTION write_audit();

-- ★ 应用角色:audit_log 只读不可写改删(写入由上面 definer 触发器代劳)
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_app') THEN
        CREATE ROLE ledger_app LOGIN;
    END IF;
END $$;

-- 显式授 schema USAGE:不依赖 public 对 PUBLIC 的默认授权(schema 重建后会丢)。
-- 没有它,下面的表级 GRANT 形同虚设,ledger_app 连表都看不到。
GRANT USAGE ON SCHEMA public TO ledger_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ledger_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
-- audit_log 例外:红线
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM ledger_app;
GRANT  SELECT ON audit_log TO ledger_app;

-- =====================================================================
-- 完整性要点(进 PRD 非功能性需求):
--  1) ledger 只能通过 posted journal_entries 变动,invoice/payment 过账
--     生成对应 journal_entries,绝不直接改余额。
--  2) trial balance = SELECT account, SUM(debit)-SUM(credit) ... 永远平。
--  3) 合并报表 = 跨 org base_amount 汇总,按 parent_org_id 聚合。
--  4) period 关账后,该期间 journal_entries 拒绝新增/修改(应用层 + status)。
--  5) audit_log 由 SECURITY DEFINER 触发器自动写;应用角色 ledger_app 只授
--     SELECT,REVOKE INSERT/UPDATE/DELETE,从权限层杜绝篡改。
--  6) 借贷平衡两道 DB 防线:trg_balanced(改 posted 凭证的行)+
--     trg_balanced_on_post(把不平/空草稿翻成 posted),配合应用层共三道。
-- =====================================================================
