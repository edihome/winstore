/**
 * ============================================================
 * File: RequireDeveloper.jsx
 * Module: Routes
 *
 * Description:
 * Backstop for direct navigation to /dashboard/organizations by
 * anyone who isn't a platform developer — AppLayout's nav already
 * hides the link for everyone else, but that alone doesn't stop the
 * route itself from rendering. This is a role check, not a resource
 * permission check (see AuthContext.hasPermission) — "developer"
 * isn't a per-organization grant, it's cross-organization reach.
 * ============================================================
 */

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireDeveloper({ children }) {
  const { user } = useAuth();

  if (user?.role !== "developer") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
