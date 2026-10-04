const { discoverPrivateAddresses } = require("./store-network");

// A local business can start even when sharing has never been enabled. Its
// certificate is created only when an owner starts the LAN listener.
const createLazyStoreNetwork = (factory) => {
    let network;
    let creating;
    let stopping;
    const starts = new Set();
    const getNetwork = async () => {
        if (network) return network;
        if (!creating) creating = factory().then((created) => { network = created; return created; }).finally(() => { creating = null; });
        return creating;
    };
    return {
        getStatus: () => network?.getStatus() || { running: false, addresses: discoverPrivateAddresses().map((address) => ({ address, name: address })) },
        start: (options) => {
            if (stopping) return Promise.reject(new Error("Store sharing is shutting down. Try again shortly."));
            const work = getNetwork().then((created) => created.start(options));
            starts.add(work);
            work.then(() => starts.delete(work), () => starts.delete(work));
            return work;
        },
        stop: () => {
            if (stopping) return stopping;
            stopping = (async () => {
                // Wait for the calls that will invoke network.start, not just
                // the factory: those calls resume after factory resolution.
                await Promise.allSettled([...starts]);
                if (creating) await creating.catch(() => {});
                await network?.stop();
            })().finally(() => { stopping = null; });
            return stopping;
        },
        getConnectionCode: () => {
            if (!network) throw new Error("Enable store sharing before copying a connection code.");
            return network.getConnectionCode();
        },
    };
};
module.exports = { createLazyStoreNetwork };
