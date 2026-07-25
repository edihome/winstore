/**
 * ============================================================
 * File: ProtectedRoute.jsx
 * Module: Routes
 *
 * Description:
 * Redirects to /login when there is no authenticated session.
 * Waits for the initial /auth/me check before deciding, so a valid
 * session isn't bounced to /login on a page refresh. A user with a
 * pending forced password change (see users.service.resetPassword /
 * users.repository.createUser on the backend) is confined to the
 * change-password page until they set one only they know — enforced
 * here too, not just by the backend's 403, so the UI doesn't dead-end
 * on an error instead of showing the form to fix it.
 * ============================================================
 */

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const CHANGE_PASSWORD_PATH = "/dashboard/administration/change-password";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="pattern-paper flex min-h-screen items-center justify-center">
        <p className="font-mono text-sm text-ink-soft">Checking your session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return children;
}
