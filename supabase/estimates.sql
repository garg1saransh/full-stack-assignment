-- =============================================================
-- ESTIMATES (Revenue slice) — run AFTER supabase/schema.sql
-- Money is always stored in minor units (BIGINT cents).
-- Soft-delete only (removed_at). No hard deletes from the app.
-- =============================================================

-- =============================================================
-- ESTIMATES
-- =============================================================
CREATE TABLE IF NOT EXISTS estimates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  project_id       UUID REFERENCES projects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  subtotal_minor   BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  tax_minor        BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor      BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  notes            TEXT,
  valid_until      DATE,
  created_by       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  sent_at          TIMESTAMPTZ,
  decided_at       TIMESTAMPTZ,
  idempotency_key  TEXT,
  removed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT estimates_total_consistency CHECK (total_minor = subtotal_minor + tax_minor)
);

CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_estimates_account_id
  ON estimates(account_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_account_status
  ON estimates(account_id, status) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_project_id
  ON estimates(project_id) WHERE removed_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_created_by
  ON estimates(created_by);

-- Idempotent creates: same key within an account returns the same estimate
CREATE UNIQUE INDEX IF NOT EXISTS idx_estimates_account_idempotency
  ON estimates(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND removed_at IS NULL;

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimates_service_role_all" ON estimates;
CREATE POLICY "estimates_service_role_all" ON estimates
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- ESTIMATE LINE ITEMS
-- =============================================================
CREATE TABLE IF NOT EXISTS estimate_line_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id        UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description        TEXT NOT NULL,
  quantity           NUMERIC(12, 4) NOT NULL CHECK (quantity > 0),
  unit_amount_minor  BIGINT NOT NULL CHECK (unit_amount_minor >= 0),
  amount_minor       BIGINT NOT NULL CHECK (amount_minor >= 0),
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_estimate_line_items_updated_at
  BEFORE UPDATE ON estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_estimate_id
  ON estimate_line_items(estimate_id, sort_order);

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimate_line_items_service_role_all" ON estimate_line_items;
CREATE POLICY "estimate_line_items_service_role_all" ON estimate_line_items
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- Guard: optional project must belong to the same account
-- =============================================================
CREATE OR REPLACE FUNCTION enforce_estimate_project_account()
RETURNS TRIGGER AS $$
DECLARE
  project_account UUID;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO project_account
  FROM projects
  WHERE id = NEW.project_id;

  IF project_account IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  IF project_account <> NEW.account_id THEN
    RAISE EXCEPTION 'project_account_mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estimates_project_account ON estimates;
CREATE TRIGGER trg_estimates_project_account
  BEFORE INSERT OR UPDATE OF project_id, account_id ON estimates
  FOR EACH ROW EXECUTE FUNCTION enforce_estimate_project_account();
