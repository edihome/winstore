/**
 * ============================================================
 * File: env.js
 * Module: Configuration
 *
 * Description:
 * Validates all required environment variables before the
 * application starts.
 *
 * If any required variable is missing, the application exits
 * immediately with a clear error.
 * ============================================================
 */

 require("dotenv").config({ quiet: true });

 const { cleanEnv, str, port, num } = require("envalid");

 const env = cleanEnv(process.env, {
     PORT: port({ default: 5000 }),
     // Desktop forces loopback; an empty host keeps cloud/LAN deployment defaults.
     HOST: str({ default: "" }),

     DATABASE_URL: str(),

     JWT_SECRET: str(),

     NODE_ENV: str({
         choices: ["development", "production", "test"],
         default: "development",
     }),

     // Comma-separated list of public browser origins allowed to call the API
     // (a cloud deployment's frontend, e.g. "https://app.example.com").
     // localhost and private LAN addresses are ALWAYS allowed regardless, so
     // an offline/LAN install needs nothing here. See config/cors.js.
     FRONTEND_URL: str({ default: "" }),

     // Whether a reverse proxy sits in front of the app. "" / "false" = direct
     // (local/LAN) — the default. "true" trusts one hop; a number trusts N
     // hops; an IP/subnet string is passed through to Express. Only enable
     // this when actually behind a trusted proxy, or clients could spoof their
     // IP via X-Forwarded-For. See app.js.
     TRUST_PROXY: str({ default: "" }),

     // Where the built frontend lives, served by the backend in production.
     // Defaults to ../frontend/dist relative to the backend. See app.js.
     FRONTEND_DIST: str({ default: "" }),

     // Offline-sync engine (see the design). "true" turns on change capture and
     // the sync worker; default off keeps the machinery dormant (migration 056
     // installed it but nothing populates it). SYNC_HUB_URL/SYNC_HUB_TOKEN point
     // a branch at its central hub; SYNC_NODE_KIND is "branch" (default) or "hub".
     SYNC_ENABLED: str({ default: "false" }),
     SYNC_HUB_URL: str({ default: "" }),
     SYNC_PUBLIC_URL: str({ default: "" }),
     SYNC_HUB_TOKEN: str({ default: "" }),
     SYNC_NODE_KIND: str({ default: "branch", choices: ["branch", "hub"] }),
     // Auto-sync worker cadence (ms). Only runs on a branch pointed at a hub.
     SYNC_INTERVAL_MS: num({ default: 300000 }),
 });

 // The JWT secret authenticates every token in the system — a weak or
 // placeholder value lets an attacker forge an admin token for any tenant.
 // Refuse to boot with a weak secret in production; nudge in development;
 // stay quiet under test (which uses short throwaway secrets on purpose).
 const WEAK_JWT_SECRETS = ["replace-this-with-a-long-random-secret", "secret", "changeme", "test-secret"];
 const isWeakSecret = (value) => value.length < 32 || WEAK_JWT_SECRETS.includes(value);

 if (isWeakSecret(env.JWT_SECRET)) {
     const advice =
         'Generate a strong one with "npm run generate-secret" and set JWT_SECRET in your environment.';
     if (env.NODE_ENV === "production") {
         throw new Error(`JWT_SECRET must be a strong, random value (at least 32 characters) in production. ${advice}`);
     }
     if (env.NODE_ENV === "development") {
         console.warn(`⚠️  JWT_SECRET is weak or a placeholder — safe for local use, but not for production. ${advice}`);
     }
 }

 module.exports = env;
