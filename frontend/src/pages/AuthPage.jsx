/**
 * ============================================================
 * File: AuthPage.jsx
 * Module: Auth
 *
 * Description:
 * Combined sign-in / create-account screen: a dark teal marketing
 * panel on the left, and a tabbed card on the right that swaps
 * between the two forms without a full page navigation. The active
 * tab still follows the URL (/login vs /register) so both stay
 * directly linkable and shareable.
 * ============================================================
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import apiClient from "../api/client";
import { getAuthInstallPolicy, getAuthMode } from "../utils/authInstall";
import { buildBranchLinkPayload } from "../utils/branchSetup";

const initialLoginForm = { email: "", password: "" };
const initialRegisterForm = {
  organizationName: "",
  branchName: "",
  firstName: "",
  lastName: "",
  email: "",
  password: "",
};
const initialAttendanceForm = { email: "", password: "" };

const FEATURES = [
  "Product retail: catalog, stock, purchasing, one invoice per sale",
  "Service booking: any service you offer, appointments, providers",
  "Attendance, roles, and permissions built in",
  "Multi-branch by default, offline-first by design",
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const desktop = window.winstoreDesktop;
  const isConnectedTill = desktop?.isDesktop === true && desktop.role === "client";
  const [connectionError, setConnectionError] = useState("");

  const [requestedMode, setMode] = useState(location.pathname === "/register" ? "register" : "login");
  // Set by the API client's global 401 handler (see api/client.js): the
  // session died mid-use and the user was brought back here.
  const [sessionNotice, setSessionNotice] = useState(() =>
    new URLSearchParams(location.search).get("expired")
      ? "Your session has ended. Please sign in again."
      : ""
  );
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [registerForm, setRegisterForm] = useState(initialRegisterForm);
  const [attendanceForm, setAttendanceForm] = useState(initialAttendanceForm);
  const [attendanceResult, setAttendanceResult] = useState(null);
  const [attendanceSubmitting, setAttendanceSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // First-run: an offline BRANCH install that hasn't been linked to its head
  // office yet shows a "link this device" screen instead of sign-in (it has no
  // users until it's linked). A normal cloud/standalone install never sees it.
  const [linkInfo, setLinkInfo] = useState(null);
  const [probeError, setProbeError] = useState("");
  const [probeRevision, setProbeRevision] = useState(0);
  const [setupCode, setSetupCode] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    // The paired host has already completed setup. Its LAN gateway keeps
    // enrollment endpoints private to the host PC.
    if (isConnectedTill) {
      setLinkInfo({ branchInstall: false, linked: true });
      setProbeError("");
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLinkInfo(null);
    setProbeError("");
    apiClient
      .get("/sync/link-status", { signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        const info = res.data?.data;
        if (info == null || getAuthInstallPolicy(info).stage === "unavailable") {
          setProbeError("The server returned an invalid device setup status. Please try again.");
          return;
        }
        setLinkInfo(info);
      })
      .catch((err) => {
        if (!cancelled) setProbeError(err.message || "Unable to check this device's setup.");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [probeRevision, isConnectedTill]);

  const installPolicy = getAuthInstallPolicy(linkInfo, probeError, isConnectedTill ? "client" : "");
  const mode = getAuthMode(isConnectedTill && requestedMode === "attendance" ? "login" : requestedMode, installPolicy);
  const showFirstRun = installPolicy.stage === "link";

  useEffect(() => {
    if ((linkInfo?.branchInstall || isConnectedTill) && installPolicy.stage === "ready" && location.pathname === "/register") {
      setMode("login");
      navigate("/login", { replace: true });
    }
  }, [linkInfo, installPolicy.stage, isConnectedTill, location.pathname, navigate]);

  const changeConnection = async () => {
    setConnectionError("");
    try {
      await desktop.changeConnection();
    } catch (err) {
      setConnectionError(err.message || "Unable to change the store connection.");
    }
  };

  const retrySetupProbe = () => {
    setLinkInfo(null);
    setProbeError("");
    setProbeRevision((revision) => revision + 1);
  };

  const handleLinkSubmit = async (event) => {
    event.preventDefault();
    if (!showFirstRun || linking) return;
    setLinkError("");
    setLinking(true);
    try {
      await apiClient.post("/sync/link", buildBranchLinkPayload(setupCode));
      // Linked: seed done. Send them to sign-in with their head-office login.
      setLinkInfo({ branchInstall: true, linked: true });
      setSetupCode("");
      setMode("login");
      setSessionNotice("Branch setup is complete. Sign in with your head-office account while still online to enable offline sign-ins on this device.");
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinking(false);
    }
  };

  // Attendance is a third tab, not a real route (a shared front-desk
  // device shouldn't need its own bookmarkable URL for this) — only
  // login/register keep the URL in sync.
  const switchMode = (nextMode) => {
    if (nextMode === "register" && !installPolicy.canRegister) return;
    setMode(nextMode);
    setError("");
    setSessionNotice("");
    setAttendanceResult(null);
    if (nextMode === "login" || nextMode === "register") {
      navigate(nextMode === "register" ? "/register" : "/login", { replace: true });
    }
  };

  const handleLoginChange = (event) => {
    setLoginForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleRegisterChange = (event) => {
    setRegisterForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleAttendanceChange = (event) => {
    setAttendanceForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(loginForm);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    if (!installPolicy.canRegister) {
      setError(isConnectedTill
        ? "This PC connects to your store host. Sign in with an existing staff account."
        : linkInfo?.branchInstall
        ? "This branch uses head-office accounts. Sign in with your head-office login."
        : "Check this device's setup before creating an account.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await register(registerForm);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Deliberately does NOT go through useAuth().login — this must never
  // store a session token or navigate into the dashboard. A shared
  // front-desk device stays on the login screen no matter whose
  // attendance was just logged; credentials are verified server-side
  // purely to confirm who's checking in/out, not to sign anyone in.
  const handleAttendanceSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setAttendanceResult(null);
    setAttendanceSubmitting(true);
    try {
      const response = await apiClient.post("/attendance/kiosk-toggle", attendanceForm);
      setAttendanceResult(response.data.data);
      setAttendanceForm(initialAttendanceForm);
    } catch (err) {
      setError(err.message);
    } finally {
      setAttendanceSubmitting(false);
    }
  };

  const resetAttendance = () => {
    setAttendanceResult(null);
    setError("");
  };

  return (
    <div className="flex min-h-screen">
      {/* Marketing panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-panel px-12 py-12 text-paper lg:flex">
        <div>
          <h1 className="font-display text-3xl font-semibold">Winstore</h1>
          <p className="mt-2 text-paper/70">Products and services — one system, one invoice.</p>
        </div>

        <div className="space-y-3">
          <p className="text-paper/70">
            Whether you sell goods, book appointments, or both — offline-first by design, multi-branch by default.
          </p>
          <ul className="space-y-2 text-sm">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-paper/90">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-soft" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Auth card */}
      <div className="pattern-paper flex w-full flex-col items-center justify-center px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center lg:hidden">
            <span className="field-label text-teal">Winstore</span>
          </div>

          {isConnectedTill && <div className="mb-4 rounded border border-paper-line bg-white px-4 py-3 text-sm">
            <p className="font-medium text-ink">Connected to your store host</p>
            <p className="mt-1 text-ink-soft">Use your staff account. Keep the host PC and local network running while you work.</p>
            <button type="button" onClick={changeConnection} className="btn-link btn-link-neutral mt-2">Change connection</button>
            {connectionError && <p role="alert" className="mt-2 text-clay">{connectionError}</p>}
          </div>}

          {installPolicy.stage === "checking" ? (
            <div className="ledger-card py-8 pr-6" role="status">
              <p className="font-display text-lg font-semibold text-ink">Checking this device</p>
              <p className="mt-2 text-sm text-ink-soft">Loading setup information from the server.</p>
            </div>
          ) : installPolicy.stage === "unavailable" ? (
            <div className="ledger-card py-8 pr-6">
              <p className="font-display text-lg font-semibold text-ink">Unable to check device setup</p>
              <p role="alert" className="mt-3 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
                {probeError || (isConnectedTill && linkInfo?.branchInstall && !linkInfo.linked
                  ? "The store host has not finished setup. Complete branch setup on the host PC, then retry here."
                  : "The server returned an invalid device setup status.")}
              </p>
              <p className="mt-3 text-sm text-ink-soft">Check that the server is available, then try again.</p>
              <button type="button" onClick={retrySetupProbe} className="btn-solid btn-solid-primary mt-4">Retry</button>
            </div>
          ) : showFirstRun ? (
            <div
              className="ledger-card py-8 pr-6"
              style={{ "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" }}
            >
              <div className="mb-5">
                <p className="font-display text-lg font-semibold text-ink">Set up this branch</p>
                <p className="text-sm text-ink-soft">
                  Connect to the internet and enter the setup code generated when your branch was added at head office. Winstore will verify the code and download your branch data for offline use.
                </p>
              </div>
              {linkError && (
                <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
                  {linkError}
                </p>
              )}
              {linking && <p role="status" aria-live="polite" className="mb-4 rounded border border-cobalt/30 bg-cobalt-soft px-3 py-2 text-sm text-cobalt">
                Verifying the setup code and downloading your branch data. Keep this app open until setup finishes.
              </p>}
              <form onSubmit={handleLinkSubmit} className="space-y-4">
                <div>
                  <label htmlFor="branchSetupCode" className="field-label mb-1 block">
                    Branch setup code
                  </label>
                  <textarea
                    id="branchSetupCode"
                    name="setupCode"
                    required
                    autoFocus
                    rows={5}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={linking}
                    placeholder="Paste the complete branch setup code"
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.target.value)}
                    className="w-full resize-none rounded border border-paper-line bg-white px-3 py-2 font-mono text-xs text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>
                <button type="submit" disabled={linking} className="btn-solid btn-solid-primary">
                  {linking ? "Setting up branch..." : "Set up branch"}
                </button>
              </form>
            </div>
          ) : (
          <>
          {!isConnectedTill && <div className={`mb-6 grid ${installPolicy.canRegister ? "grid-cols-3" : "grid-cols-2"} overflow-hidden rounded-lg border border-paper-line bg-white p-1`}>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`rounded-md py-2 text-sm font-medium transition ${
                mode === "login" ? "bg-panel text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              Sign in
            </button>
            {installPolicy.canRegister && <button
              type="button"
              onClick={() => switchMode("register")}
              className={`rounded-md py-2 text-sm font-medium transition ${
                mode === "register" ? "bg-panel text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              Create account
            </button>}
            <button
              type="button"
              onClick={() => switchMode("attendance")}
              className={`rounded-md py-2 text-sm font-medium transition ${
                mode === "attendance" ? "bg-panel text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              Attendance
            </button>
          </div>}

          <div
            className="ledger-card py-8 pr-6"
            style={
              mode === "attendance"
                ? { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" }
                : undefined
            }
          >
            {mode === "login" && (
              <div className="mb-5">
                <p className="font-display text-lg font-semibold text-ink">Welcome back</p>
                <p className="text-sm text-ink-soft">Sign in to your Winstore workspace.</p>
              </div>
            )}
            {mode === "register" && (
              <div className="mb-5">
                <p className="font-display text-lg font-semibold text-ink">Set up your organization</p>
                <p className="text-sm text-ink-soft">
                  This creates your headquarters branch and an administrator account.
                </p>
              </div>
            )}
            {mode === "attendance" && (
              <div className="mb-5">
                <p className="font-display text-lg font-semibold text-ink">Staff attendance</p>
                <p className="text-sm text-ink-soft">
                  Stepping out or just arrived? Confirm your password to log it — this doesn't sign you in.
                </p>
              </div>
            )}

            {sessionNotice && !error && (
              <p role="status" className="mb-4 rounded border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber-dark">
                {sessionNotice}
              </p>
            )}
            {error && (
              <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
                {error}
              </p>
            )}

            {mode === "login" && (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="field-label mb-1 block">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={loginForm.email}
                    onChange={handleLoginChange}
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="field-label mb-1 block">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={loginForm.password}
                    onChange={handleLoginChange}
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>

                <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
                  {submitting ? "Signing in…" : "Sign in"}
                </button>
              </form>
            )}
            {mode === "register" && (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label htmlFor="organizationName" className="field-label mb-1 block">
                    Organization name
                  </label>
                  <input
                    id="organizationName"
                    name="organizationName"
                    required
                    value={registerForm.organizationName}
                    onChange={handleRegisterChange}
                    placeholder="e.g. Bloom Wellness Group"
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>

                <div>
                  <label htmlFor="branchName" className="field-label mb-1 block">
                    Headquarters branch <span className="normal-case text-ink-soft">(optional)</span>
                  </label>
                  <input
                    id="branchName"
                    name="branchName"
                    value={registerForm.branchName}
                    onChange={handleRegisterChange}
                    placeholder="Main Branch"
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="firstName" className="field-label mb-1 block">
                      First name
                    </label>
                    <input
                      id="firstName"
                      name="firstName"
                      required
                      value={registerForm.firstName}
                      onChange={handleRegisterChange}
                      className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="field-label mb-1 block">
                      Last name
                    </label>
                    <input
                      id="lastName"
                      name="lastName"
                      required
                      value={registerForm.lastName}
                      onChange={handleRegisterChange}
                      className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="registerEmail" className="field-label mb-1 block">
                    Email
                  </label>
                  <input
                    id="registerEmail"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={registerForm.email}
                    onChange={handleRegisterChange}
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>

                <div>
                  <label htmlFor="registerPassword" className="field-label mb-1 block">
                    Password <span className="normal-case text-ink-soft">(min. 8 characters)</span>
                  </label>
                  <input
                    id="registerPassword"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={registerForm.password}
                    onChange={handleRegisterChange}
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>

                <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
                  {submitting ? "Creating organization…" : "Create account"}
                </button>
              </form>
            )}
            {mode === "attendance" &&
              (attendanceResult ? (
                <div className="space-y-4">
                  <div className="rounded border border-cobalt/30 bg-cobalt-soft px-4 py-3">
                    <p className="text-sm font-semibold text-cobalt">
                      {attendanceResult.staffName} —{" "}
                      {attendanceResult.action === "checked_in" ? "checked in" : "checked out"}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-ink-soft">
                      {new Date(attendanceResult.time).toLocaleString()}
                    </p>
                  </div>
                  <button type="button" onClick={resetAttendance} className="btn-solid btn-solid-primary">
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAttendanceSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="attendanceEmail" className="field-label mb-1 block">
                      Email
                    </label>
                    <input
                      id="attendanceEmail"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={attendanceForm.email}
                      onChange={handleAttendanceChange}
                      className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                    />
                  </div>

                  <div>
                    <label htmlFor="attendancePassword" className="field-label mb-1 block">
                      Password
                    </label>
                    <input
                      id="attendancePassword"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={attendanceForm.password}
                      onChange={handleAttendanceChange}
                      className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                    />
                  </div>

                  <button type="submit" disabled={attendanceSubmitting} className="btn-solid btn-solid-primary">
                    {attendanceSubmitting ? "Checking…" : "Check in / out"}
                  </button>
                </form>
              ))}
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
