const { validateMode } = require("./install-mode");

const buildBackendEnvironment = ({ mode, inheritedEnv, databaseUrl, port, jwtSecret, frontendDist }) => {
    validateMode(mode);
    return {
        ...inheritedEnv,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(port),
        HOST: "127.0.0.1",
        DATABASE_URL: databaseUrl,
        JWT_SECRET: jwtSecret,
        FRONTEND_DIST: frontendDist,
        SYNC_ENABLED: mode === "branch" ? "true" : "false",
        SYNC_NODE_KIND: "branch",
        // Enrollment stores the link in PostgreSQL. Host-machine env must not
        // redirect this desktop or override its persisted branch credentials.
        SYNC_HUB_URL: "",
        SYNC_HUB_TOKEN: "",
        // Only the local TLS gateway can forward LAN peer addresses. The
        // backend stays on loopback; external proxy headers are overwritten.
        TRUST_PROXY: "loopback",
    };
};

module.exports = { buildBackendEnvironment };
