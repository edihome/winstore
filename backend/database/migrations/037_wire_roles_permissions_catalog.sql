-- Every module protected by useProtectedResource() in routes/index.js
-- needs a "<resource>:manage" permission row to exist before it can be
-- granted to a role. Registration only ever created 5 of the 26
-- protected resources (the admin-only ones), so no role other than the
-- hardcoded "super_admin" role-name bypass could ever be granted access
-- to Sales, Customers, Inventory, and the rest.
--
-- Add uniqueness so the catalog can be safely re-provisioned with
-- ON CONFLICT DO NOTHING (see auth.service.register, which now inserts
-- the full catalog for every new organization), then backfill every
-- existing organization with the missing permissions now.
ALTER TABLE permissions
    ADD CONSTRAINT permissions_org_resource_action_unique UNIQUE (organization_id, resource, action);

INSERT INTO permissions (id, organization_id, name, resource, action, created_at, updated_at)
SELECT gen_random_uuid(), o.id, m.resource || ':manage', m.resource, 'manage', NOW(), NOW()
FROM organizations o
CROSS JOIN (VALUES
    ('organizations'), ('branches'), ('roles'), ('permissions'), ('users'),
    ('settings'), ('audit'), ('notifications'), ('attendance'),
    ('customers'), ('suppliers'), ('purchases'), ('products'), ('categories'),
    ('inventory'), ('stock_movements'), ('sales'), ('payments'), ('discounts'),
    ('taxes'), ('expenses'), ('budgets'), ('cash_register'), ('reports'),
    ('salon_services'), ('salon_appointments')
) AS m(resource)
ON CONFLICT (organization_id, resource, action) DO NOTHING;

-- Grant the full catalog to every existing "super_admin"-named role too,
-- so the new Roles UI shows reality even though the role-name bypass in
-- middlewares/permission.js already grants those users full access
-- regardless of what's actually linked here.
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), r.id, p.id, NOW()
FROM roles r
INNER JOIN permissions p ON p.organization_id = r.organization_id
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
