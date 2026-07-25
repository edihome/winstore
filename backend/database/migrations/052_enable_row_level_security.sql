-- Tenant isolation enforced by the DATABASE, not just by application WHERE
-- clauses. Every tenant table gets ROW LEVEL SECURITY (FORCED, since the app
-- role owns the tables) and a policy keyed on the per-connection settings the
-- app sets each request (see config/db.js + middlewares/orgContext.js):
--
--   * app.current_org unset  -> no rows (safe default: a query that forgets
--                               its org filter leaks nothing)
--   * app.current_org = <id> -> only that organization's rows
--   * app.bypass_rls = 'on'  -> unrestricted (login/registration/kiosk and
--                               the developer role only)
--
-- NULLIF(...,'') guards against the reset value '' being cast to uuid.

-- Tables carrying organization_id directly: one uniform policy each.
DO $$
DECLARE
    t text;
    org_tables text[] := ARRAY[
        'appointments','attendance','audit_logs','branches','budgets',
        'cash_register_transactions','cash_registers','categories','customers',
        'discounts','expenses','payments','permissions','product_stock','products',
        'purchase_items','purchases','roles','sale_items','sale_returns','sales',
        'services','settings','stock_batches','stock_movements','subscription_payments',
        'suppliers','taxes','users'
    ];
BEGIN
    FOREACH t IN ARRAY org_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON %I
            USING (
                organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
                OR current_setting('app.bypass_rls', true) = 'on'
            )
            WITH CHECK (
                organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
                OR current_setting('app.bypass_rls', true) = 'on'
            )
        $f$, t);
    END LOOP;
END $$;

-- Tenant root: an organization can only see (and modify) its own row.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
    USING (
        id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- Org-less child tables: isolate through their parent's organization.
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM roles r
            WHERE r.id = role_permissions.role_id
              AND r.organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM roles r
            WHERE r.id = role_permissions.role_id
              AND r.organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        )
    );

ALTER TABLE sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_return_items
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM sale_returns sr
            WHERE sr.id = sale_return_items.return_id
              AND sr.organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM sale_returns sr
            WHERE sr.id = sale_return_items.return_id
              AND sr.organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        )
    );

ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_branches
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = user_branches.user_id
              AND u.organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = user_branches.user_id
              AND u.organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        )
    );
