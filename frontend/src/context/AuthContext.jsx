/**
 * ============================================================
 * File: AuthContext.jsx
 * Module: Auth
 *
 * Description:
 * Holds the current session (token + user) in memory, persists the
 * token to localStorage so a refresh doesn't log the user out, and
 * exposes register/login/logout actions used by the auth pages.
 * ============================================================
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import apiClient from "../api/client";

const TOKEN_KEY = "winstore_token";
const ACTIVE_BRANCH_KEY_PREFIX = "winstore_active_branch_";
// Matches components/SubscriptionAlertBanner.jsx's own constant — clearing
// it on every login is what makes that banner reappear "at every login"
// even if a previous session dismissed it.
const SUBSCRIPTION_ALERT_DISMISSED_KEY = "winstore_subscription_alert_dismissed";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  // "loading" covers the initial /auth/me fetch on page load so protected
  // routes don't flash a redirect to /login before we know the token is
  // valid. With no stored token there's nothing to fetch, so start settled.
  const [loading, setLoading] = useState(Boolean(token));
  // Which of the user's accessible branches they're currently acting as.
  // Only meaningful for users granted more than one; defaults to their
  // primary branch and persists per-user across refreshes.
  const [activeBranchId, setActiveBranchIdState] = useState(null);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await apiClient.get("/auth/me");
      setUser(response.data.data);
    } catch {
      // Token is missing, expired, or invalid — drop it and treat as logged out.
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchProfile();
    }
    // Only run on mount — login/register call fetchProfile themselves, so
    // token changes after mount must not re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the active branch whenever the profile (re)loads: keep a
  // previously chosen branch if it's still accessible, otherwise fall
  // back to the user's primary branch.
  useEffect(() => {
    if (!user) {
      setActiveBranchIdState(null);
      return;
    }
    const stored = localStorage.getItem(ACTIVE_BRANCH_KEY_PREFIX + user.id);
    const accessible = user.accessibleBranches || [];
    const storedIsValid = stored && accessible.some((branch) => branch.id === stored);
    setActiveBranchIdState(storedIsValid ? stored : user.branch?.id || null);
  }, [user]);

  const setActiveBranchId = (branchId) => {
    setActiveBranchIdState(branchId);
    if (user) {
      localStorage.setItem(ACTIVE_BRANCH_KEY_PREFIX + user.id, branchId);
    }
  };

  const login = async (credentials) => {
    const response = await apiClient.post("/auth/login", credentials);
    const { token: newToken } = response.data.data;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    sessionStorage.removeItem(SUBSCRIPTION_ALERT_DISMISSED_KEY);
    // The login endpoint returns a lightweight user shape (flat organizationId/
    // branchId) for the JWT payload's sake. The rest of the app — AppLayout,
    // DashboardPage — expects the richer nested { organization, branch } shape
    // that /auth/me returns. Always fetch that single canonical shape here so
    // there's never a mismatch between "just logged in" and "refreshed the page".
    return fetchProfile();
  };

  const register = async (payload) => {
    // Registration creates the organization + admin user but does not log
    // the user in on its own — chain into login so the flow ends on the
    // dashboard with a real session, not a dead end.
    await apiClient.post("/auth/register", payload);
    return login({ email: payload.email, password: payload.password });
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  // Swap in a freshly issued token (e.g. after changing a password) and
  // refetch the profile against it. A plain profile refetch wouldn't be
  // enough here — claims like mustChangePassword live in the token
  // itself, so the old token would keep enforcing them until the next
  // full login without this.
  const applyNewToken = async (newToken) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    return fetchProfile();
  };

  const activeBranch =
    (user?.accessibleBranches || []).find((branch) => branch.id === activeBranchId) || user?.branch || null;

  // "super_admin" (an org's own owner) and "developer" (a platform
  // operator — see backend/utils/isPrivilegedRole.js) both bypass every
  // permission check on the backend; mirror that here so neither loses
  // access to a nav item or page just because this frontend check exists.
  // Everyone else needs the specific "<resource>:manage" grant. Accepts
  // either one resource or a list (true if any are granted), for pages
  // built from more than one resource (e.g. Billing = taxes + discounts).
  const hasPermission = (resource) => {
    if (!user) return false;
    if (user.role === "super_admin" || user.role === "developer") return true;
    const resources = Array.isArray(resource) ? resource : [resource];
    return resources.some((r) => (user.permissions || []).includes(`${r}:manage`));
  };

  const value = {
    token,
    user,
    loading,
    isAuthenticated: Boolean(token && user),
    login,
    register,
    logout,
    applyNewToken,
    // Re-fetch the profile (incl. org settings) so a settings change —
    // e.g. saving the Business Profile / receipt branding — takes effect
    // immediately without a re-login.
    refreshProfile: fetchProfile,
    activeBranch,
    setActiveBranchId,
    hasPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Keeping the hook next to its provider is the conventional context setup;
// the only cost is slightly coarser hot-module reloading for this file.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
