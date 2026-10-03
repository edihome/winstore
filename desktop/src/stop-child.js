// Wait for a child to exit before the database is stopped. A service that does
// not finish graceful shutdown is force-killed after a bounded delay.
const stopChild = (child, { gracefulMs = 5000, forceMs = 5000 } = {}) => {
    if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let timer;
        let finished = false;
        const finish = (error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            child.removeListener("exit", onExit);
            child.removeListener("error", onError);
            if (error) reject(error);
            else resolve();
        };
        const onExit = () => finish();
        const onError = (error) => finish(error);
        child.once("exit", onExit);
        child.once("error", onError);
        try {
            child.kill("SIGTERM");
        } catch (error) {
            finish(error);
        }
        if (!finished) timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            } catch (error) {
                finish(error);
            }
            if (!finished) timer = setTimeout(() => finish(new Error("The local Winstore service did not stop after being force-killed.")), forceMs);
        }, gracefulMs);
    });
};

module.exports = { stopChild };
