const { resolveDesktopConfig } = require("./install-mode");

const setup = ({ userData, pgDataDir, dialog, chooseConnection }) => resolveDesktopConfig({
    userData,
    pgDataDir,
    chooseConfig: async () => {
        const role = await dialog.showMessageBox({
            type: "question",
            title: "Set up Winstore",
            message: "How will this computer be used?",
            detail: "Host this store: keep the store's data on this computer. Other tills can connect to it.\n\nConnect to this store: use the data on the store's host computer.",
            buttons: ["Host this store", "Connect to this store", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
        });
        if (role.response === 2 || ![0, 1].includes(role.response)) return null;
        if (role.response === 1) {
            if (typeof chooseConnection !== "function") throw new Error("Store connection setup is unavailable.");
            const connection = await chooseConnection();
            return connection === null ? null : { version: 2, role: "client", connection };
        }
        const { response } = await dialog.showMessageBox({
            type: "question",
            title: "Set up your store",
            message: "How is this store managed?",
            detail: "Standalone business: register your business on this computer.\n\nHead-office branch: enter the branch setup code from head office, download this branch's data, and work offline.",
            buttons: ["Standalone business", "Head-office branch", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
        });
        const mode = ["standalone", "branch"][response];
        return mode ? { version: 2, role: "host", mode, sharingEnabled: false, autoStart: false } : null;
    },
});

module.exports = { setup };
