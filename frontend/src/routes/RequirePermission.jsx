/**
 * ============================================================
 * File: RequirePermission.jsx
 * Module: Routes
 *
 * Description:
 * Backstop for direct navigation (typed URL, stale bookmark) to a page
 * the user's role doesn't grant — AppLayout's nav already hides the
 * link, but that alone doesn't stop the route itself from rendering.
 * Redirects to the dashboard, same silent-redirect pattern
 * ProtectedRoute already uses for an unauthenticated session.
 * ============================================================
 */

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequirePermission({ resource, children }) {
  const { user, hasPermission } = useAuth();

  // A subscription-locked session would only get 403s from any module
  // page's API calls — send it to the one page that explains why.
  if (user?.subscriptionLocked) {
    return <Navigate to="/dashboard/administration/subscription" replace />;
  }

  if (!hasPermission(resource)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
