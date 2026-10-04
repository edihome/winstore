const http = require("node:http");

// Always authenticate against the local backend, never a renderer-supplied URL.
const readOwner = (backendUrl, token) => new Promise((resolve, reject) => {
    if (typeof token !== "string" || !token || token.length > 8192 || /[\r\n]/.test(token)) {
        reject(new Error("Sign in as the store owner to manage sharing."));
        return;
    }
    const req = http.get(`${backendUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
            body += chunk;
            if (body.length > 131072) req.destroy(new Error("Invalid owner profile response."));
        });
        res.on("end", () => {
            try {
                const user = JSON.parse(body).data;
                if (res.statusCode !== 200 || !user || !["super_admin", "developer"].includes(user.role)
                    || user.mustChangePassword || user.subscriptionLocked || user.isActive === false || !user.organization?.id) {
                    throw new Error("Sign in as the store owner to manage sharing.");
                }
                resolve(user);
            } catch (error) { reject(error instanceof SyntaxError ? new Error("Unable to verify your account.") : error); }
        });
        res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("The local store server is unavailable.")));
    req.on("error", reject);
});

const createSharingController = ({ config, backendUrl, network, saveConfig, configureFirewall, setLoginItem, authenticateOwner = readOwner }) => {
    let current = config;
    let lastError = "";
    let pending = Promise.resolve();
    let closing = false;
    // Serialize owner mutations so settings and the actual listener agree.
    const mutate = (work) => {
        if (closing) return Promise.reject(new Error("The store server is stopping."));
        const result = pending.then(() => {
            if (closing) throw new Error("The store server is stopping.");
            return work();
        });
        pending = result.catch(() => {});
        return result;
    };
    const status = () => {
        if (current.role === "client") return { role: "client", enabled: false, address: current.connection.origin, storeName: current.connection.storeName || "Your store", autoStart: false };
        const live = network?.getStatus() || {};
        return { role: "host", enabled: !!live.running, address: live.origin || "", addresses: live.addresses || [], storeName: current.storeName || live.storeName || "", autoStart: current.autoStart, error: lastError };
    };
    const owner = async (token) => {
        if (current.role !== "host") throw new Error("Manage sharing on the main store PC.");
        const user = await authenticateOwner(backendUrl, token);
        if (current.organizationId && current.organizationId !== user.organization.id) throw new Error("This account belongs to a different store.");
        return user;
    };
    const persist = async (next) => {
        await saveConfig(next);
        current = next;
    };
    return {
        getStatus: status,
        getConfig: () => current,
        resume: async () => {
            if (current.role !== "host" || !current.sharingEnabled) return status();
            try {
                await network.start({ address: current.sharingAddress, storeName: current.storeName });
                lastError = "";
            } catch (error) { lastError = `Sharing could not resume: ${error.message} Open store settings to retry.`; }
            return status();
        },
        enable: (token, address) => mutate(async () => {
            const user = await owner(token);
            const storeName = user.branch?.name || user.organization.name;
            const addresses = network.getStatus().addresses || [];
            const selected = address || current.sharingAddress || (addresses.length === 1 ? addresses[0].address : null);
            if (!selected || !addresses.some((entry) => entry.address === selected)) {
                throw new Error("Choose the store's local network address before enabling sharing.");
            }
            if (network.getStatus().running) {
                if (network.getStatus().address !== selected) throw new Error("Stop sharing before changing the store network address.");
                return status();
            }
            // On Windows this invokes UAC only following the owner's action.
            await configureFirewall(selected);
            if (closing) throw new Error("The store server is stopping.");
            try {
                await network.start({ address: selected, storeName });
                const live = network.getStatus();
                await persist({ ...current, sharingEnabled: true, storeName, organizationId: user.organization.id, sharingAddress: live.address });
                lastError = "";
            } catch (error) {
                await network.stop();
                lastError = error.message;
                throw error;
            }
            return status();
        }),
        disable: (token) => mutate(async () => {
            await owner(token);
            await persist({ ...current, sharingEnabled: false });
            await network.stop();
            lastError = "";
            return status();
        }),
        getConnectionCode: async (token) => {
            if (closing) throw new Error("The store server is stopping.");
            await owner(token);
            if (!network.getStatus().running) throw new Error("Enable store sharing before copying a connection code.");
            return network.getConnectionCode();
        },
        setAutoStart: (token, enabled) => mutate(async () => {
            await owner(token);
            if (typeof enabled !== "boolean") throw new Error("Choose whether Winstore should start at sign-in.");
            await setLoginItem(enabled);
            try { await persist({ ...current, autoStart: enabled }); }
            catch (error) { await setLoginItem(current.autoStart); throw error; }
            return status();
        }),
        stop: async () => { closing = true; await pending; await network?.stop(); },
    };
};

module.exports = { createSharingController, readOwner };
