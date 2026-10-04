// Client startup deliberately never imports or starts local business services.
const createDesktopRuntime = ({ loadHostServices, verifyConnection }) => {
    let services;
    let sharing;
    let startup;
    let stopping = false;
    const start = async (config) => {
        if (config.role === "client") { await verifyConnection(config.connection); return; }
        if (config.role !== "host") throw new Error("Choose a valid computer role.");
        services = loadHostServices();
        await services.postgres.start();
        if (stopping) return;
        await services.migrate.run();
        if (stopping) return;
        services.backend.start(config.mode);
        await services.backend.waitUntilHealthy();
    };
    return {
        start: (config) => {
            if (startup || stopping) throw new Error("The store runtime has already started or is stopping.");
            startup = start(config);
            return startup;
        },
        setSharing: (controller) => { sharing = controller; },
        stop: async () => {
            stopping = true;
            await startup?.catch(() => {});
            await sharing?.stop();
            if (services) { await services.backend.stop(); await services.postgres.stop(); }
        },
    };
};
module.exports = { createDesktopRuntime };
