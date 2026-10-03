// Keep these baseline grants aligned with the backend permission catalog.
// They are checked independently of the profile so an older session retains
// the capabilities that every organization member is allowed to use.
const BASELINE_MANAGE = new Set(["customers", "sales", "appointments"]);
const BASELINE_READ = new Set(["services", "products", "discounts", "taxes", "users"]);

/** Match the API's resource/action authorization, with any-match arrays. */
export function hasPermissionForUser(user, resource, action = "view") {
  if (!user) return false;
  if (user.role === "super_admin" || user.role === "developer") return true;

  const resources = Array.isArray(resource) ? resource : [resource];
  const permissions = user.permissions || [];
  return resources.some((entry) => {
    // Refund has an additional explicit action gate on the API. The baseline
    // sales:manage permission must never enable refunding a customer's sale.
    if (entry === "sales" && action === "refund") {
      return permissions.includes("sales:refund");
    }
    if (BASELINE_MANAGE.has(entry) || permissions.includes(`${entry}:manage`)) return true;
    if (permissions.includes(`${entry}:${action}`)) return true;
    return action === "view" &&
      (BASELINE_READ.has(entry) || permissions.includes(`${entry}:read`));
  });
}

// These business rules still use the backend's legacy management grants:
// credit-limit changes and enrolling offline branches affect the whole org.
export function isAdministrativeUser(user) {
  return hasPermissionForUser(user, ["users", "roles", "branches"], "manage");
}
