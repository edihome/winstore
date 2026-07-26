/**
 * ============================================================
 * File: server.js
 *
 * Description:
 * Entry point of the Winstore backend.
 *
 * Responsibilities
 * - Load environment variables
 * - Connect to PostgreSQL
 * - Start Express server
 * ============================================================
 */

const env = require("./config/env");
const app = require("./app");
const pool = require("./config/db");
const syncScheduler = require("./core/sync/sync.scheduler");
const syncConfig = require("./core/sync/sync.config");
 
const PORT = env.PORT;
/**
 * Test database connection before starting the server.
 */
async function startServer() {
    try {
        await pool.query("SELECT NOW()");

        console.log("✅ PostgreSQL Connected");

        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌍 http://localhost:${PORT}/api/v1/health`);
        });

        // Load this branch's persisted hub link (if any) BEFORE the worker
        // starts, so an enrolled branch resumes syncing on boot with no env.
        await syncConfig.load();
        // Auto-sync worker: only runs on a branch (no-op until it's linked).
        syncScheduler.start();

        // Graceful shutdown: on a restart/stop (e.g. a Windows service or PM2
        // recycling the process, or Ctrl-C), stop accepting new connections,
        // let in-flight requests finish, then close the DB pool — so a deploy
        // or reboot doesn't sever an active checkout mid-transaction.
        const shutdown = (signal) => {
            console.log(`\n${signal} received — shutting down gracefully…`);
            syncScheduler.stop();
            server.close(async () => {
                try {
                    await pool.end();
                } catch (error) {
                    console.error("Error closing the database pool:", error);
                }
                process.exit(0);
            });
            // Don't hang forever if a connection is stuck.
            setTimeout(() => process.exit(1), 10000).unref();
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("❌ Failed to start server");
        console.error(error);

        process.exit(1);
    }
}

startServer();