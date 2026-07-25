/**
 * ============================================================
 * File: app.js
 * Description:
 * Configures the Express application.
 * ============================================================
 */
 const fs = require("node:fs");
 const path = require("node:path");
 const morgan = require("morgan");
 const express = require("express");
 const cors = require("cors");
 const helmet = require("helmet");

 const routes = require("./routes");
 const env = require("./config/env");
 const { corsOptions } = require("./config/cors");
 const { generalApiRateLimiter } = require("./middlewares/rateLimiters");
 const { attachRequestId, accessLogger } = require("./middlewares/httpLogger");

 const notFound = require("./middlewares/notFound");
 const errorHandler = require("./middlewares/errorHandler");

 const app = express();

 /**
  * Correlation id on every request (echoed as the X-Request-Id header and
  * included in error responses and logs), so an incident can be traced.
  */
 app.use(attachRequestId);

 /**
  * Trust a reverse proxy in front of the app ONLY when configured, so req.ip
  * (which rate limiting and logging rely on) is the real client rather than
  * the proxy. Off by default for direct local/LAN installs — trusting
  * X-Forwarded-For without a proxy would let clients spoof their IP.
  */
 if (env.TRUST_PROXY && env.TRUST_PROXY !== "false") {
     const trustProxy =
         env.TRUST_PROXY === "true"
             ? 1
             : Number.isNaN(Number(env.TRUST_PROXY))
             ? env.TRUST_PROXY
             : Number(env.TRUST_PROXY);
     app.set("trust proxy", trustProxy);
 }

 /**
  * Set common security headers (XSS/sniffing/clickjacking protection).
  */
 app.use(helmet());
 /**
  * Enable CORS. Offline-first: localhost and LAN origins are always allowed;
  * public origins come from FRONTEND_URL. See config/cors.js.
  */
 app.use(cors(corsOptions));
 /**
 * Access logging. Development keeps morgan's colored, human-readable output;
 * production emits one structured (JSON) line per request with the request
 * id, status, and duration; test logs nothing (the in-process suite would
 * otherwise bury the reporter's output).
 */
if (env.NODE_ENV === "development") {
    app.use(morgan("dev"));
} else if (env.NODE_ENV === "production") {
    app.use(accessLogger);
}
 /**
  * Parse JSON request bodies. The 1mb limit (up from the 100kb default)
  * leaves room for an organization's receipt logo, which is stored inline
  * as a small base64 image data URI in settings.
  */
 app.use(express.json({ limit: "1mb" }));
 
 /**
  * Register API routes, behind a broad per-client rate ceiling.
  */
 app.use("/api/v1", generalApiRateLimiter, routes);

 /**
  * In production, serve the built React app from the SAME origin as the API.
  * This is what lets ONE build run identically on a single shop PC
  * (localhost), a shop LAN (the server PC's IP), or a cloud server (a domain
  * behind TLS) — the browser loads the app and calls the API on the same
  * host, so there's nothing per-environment to configure in the frontend.
  * Static assets are served directly; any other (non-API) path returns
  * index.html so client-side routing works on refresh/deep links.
  * Development is untouched — Vite serves the app on its own port.
  */
 if (env.NODE_ENV === "production") {
     const distPath = env.FRONTEND_DIST || path.resolve(__dirname, "../../frontend/dist");
     if (fs.existsSync(path.join(distPath, "index.html"))) {
         app.use(express.static(distPath));
         // Anything not starting with /api → the SPA entry point.
         app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
             res.sendFile(path.join(distPath, "index.html"));
         });
     } else {
         console.warn(`⚠️  NODE_ENV=production but no built frontend at ${distPath} — API only. Run "npm run build:web".`);
     }
 }

 /**
  * Handle unknown routes.
  */
 app.use(notFound);
 
 /**
  * Global error handler.
  *
  * Must always be the last middleware.
  */
 app.use(errorHandler);
 
 module.exports = app;