/**
 * ============================================================
 * File: RequireSuperAdmin.jsx
 * Module: Routes
 *
 * Description:
 * Backstop for direct navigation to owner-only pages (the tenant's
 * Subscription page) — same pattern as RequireDeveloper: the nav
 * already hides the link, this stops the route itself from rendering.
 * A role check, not a resource permission: subscription renewal is the
 * organization owner's concern, never a grantable staff module (the
 * backend gates /subscription the same way — see routes/index.js).
 * ============================================================
 */

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireSuperAdmin({ children }) {
  const { user } = useAuth();

  if (user?.role !== "super_admin" && user?.role !== "developer") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
