const { resolveInstallMode } = require("./install-mode");

const setup = ({ userData, pgDataDir, dialog }) => resolveInstallMode({
    userData,
    pgDataDir,
    chooseMode: async () => {
        const { response } = await dialog.showMessageBox({
            type: "question",
            title: "Set up Winstore",
            message: "How will this device be used?",
            detail: "Standalone business: create and manage your own organization on this device.\n\nHead-office branch: connect to an existing head office using its address and enrollment code, then work with downloaded data offline.\n\nThis choice is saved on this device.",
            buttons: ["Standalone business", "Head-office branch", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
        });
        return ["standalone", "branch"][response] || null;
    },
});

module.exports = { setup };
