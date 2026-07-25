/**
 * ============================================================
 * File: client.js
 * Module: API
 *
 * Description:
 * Shared Axios instance for talking to the Winstore backend.
 * Attaches the stored JWT to every request and normalizes error
 * shapes coming back from the API's standard response envelope.
 * ============================================================
 */

import axios from "axios";

// Where the API lives:
//  - an explicit VITE_API_URL always wins (e.g. a separate API host);
//  - a PRODUCTION build defaults to the SAME origin that served the app
//    ("/api/v1"), so one build runs identically on a single shop PC
//    (localhost), a shop LAN (the server PC's IP), or a cloud domain — the
//    backend serves both the app and the API;
//  - development defaults to the backend's dev port (Vite serves the app on
//    5173, the API runs on 5000).
const baseURL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api/v1" : "http://localhost:5000/api/v1");

const apiClient = axios.create({
  baseURL,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("winstore_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Endpoints where a 401 means "wrong credentials", not "session died" —
// the global session-expiry redirect below must never fire for these.
const CREDENTIAL_PATHS = ["/auth/login", "/auth/register", "/attendance/kiosk-toggle"];

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Global session-expiry handling: an expired/invalid token anywhere
    // in the app ends the session cleanly at the login screen with a
    // notice, instead of every open page sprouting its own
    // "Invalid or expired token." error wherever the user clicks next.
    const isCredentialCheck = CREDENTIAL_PATHS.some((path) => error.config?.url?.includes(path));
    if (error.response?.status === 401 && !isCredentialCheck && localStorage.getItem("winstore_token")) {
      localStorage.removeItem("winstore_token");
      window.location.assign("/login?expired=1");
    }

    // The backend always responds with { success, message, errors }.
    // Normalize so callers can just read error.message.
    const message =
      error.response?.data?.message ||
      error.message ||
      "Something went wrong. Please try again.";

    const normalized = new Error(message);
    // The HTTP status, so callers can special-case (e.g. 409 = a concurrent
    // edit conflict, prompting a reload).
    normalized.status = error.response?.status;
    // Set only on a blocked hard-delete (see backend/src/utils/hardDelete.js)
    // so callers can offer a "delete anyway" retry instead of a dead end.
    normalized.blockedByDependents = error.response?.data?.blockedByDependents === true;
    return Promise.reject(normalized);
  }
);

export default apiClient;
