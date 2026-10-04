const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { NETWORK_PORT, isPrivateIPv4 } = require("./store-network");

const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
const encodePowerShell = (value) => Buffer.from(value, "utf16le").toString("base64");

const buildFirewallCommand = ({ executablePath, port = NETWORK_PORT, address }, { systemRoot = process.env.SystemRoot || "C:\\Windows" } = {}) => {
    if (typeof executablePath !== "string" || !path.win32.isAbsolute(executablePath) || !/^[A-Za-z]:[\\/]/.test(executablePath) ||
        /^\\\\/.test(executablePath) || !/\.exe$/i.test(executablePath) || /[\r\n\u0000]/.test(executablePath)) {
        throw new Error("Store sharing requires the absolute path to the Winstore executable.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The store firewall port is invalid.");
    if (address !== undefined && !isPrivateIPv4(address)) throw new Error("The store firewall address must be a private IPv4 address.");
    const ruleName = `Winstore-Store-${crypto.createHash("sha256").update(path.win32.normalize(executablePath).toLowerCase()).digest("hex").slice(0, 20)}`;
    const powerShell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const elevated = [
        "$ErrorActionPreference = 'Stop'",
        "try {",
        "  $parameters = @{",
        `    Name = ${quotePowerShell(ruleName)}`,
        "    Enabled = 'True'",
        "    Direction = 'Inbound'",
        "    Action = 'Allow'",
        "    Profile = 'Private'",
        "    Protocol = 'TCP'",
        `    LocalPort = ${quotePowerShell(port)}`,
        `    LocalAddress = ${quotePowerShell(address || "Any")}`,
        "    RemoteAddress = 'LocalSubnet'",
        `    Program = ${quotePowerShell(executablePath)}`,
        "    EdgeTraversalPolicy = 'Block'",
        "    Description = 'Winstore encrypted store sharing on the private local network.'",
        "  }",
        `  $existing = Get-NetFirewallRule -Name ${quotePowerShell(ruleName)} -ErrorAction SilentlyContinue`,
        "  if ($existing) { Set-NetFirewallRule @parameters -ErrorAction Stop | Out-Null }",
        "  else { New-NetFirewallRule @parameters -DisplayName 'Winstore store sharing' -ErrorAction Stop | Out-Null }",
        "  exit 0",
        "} catch { [Console]::Error.WriteLine('Winstore could not configure the private store firewall rule.'); exit 1 }",
    ].join("\n");
    const launcher = [
        "$ErrorActionPreference = 'Stop'",
        "try {",
        `  $helper = Start-Process -FilePath ${quotePowerShell(powerShell)} -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',${quotePowerShell(encodePowerShell(elevated))} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop`,
        "  if ($helper.ExitCode -ne 0) { throw 'The private store firewall rule was not configured.' }",
        "  exit 0",
        "} catch { [Console]::Error.WriteLine('Windows did not allow the store firewall change. Approve the Windows administrator prompt to enable sharing, or ask an administrator to configure it.'); exit 1 }",
    ].join("\n");
    return { file: powerShell, args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(launcher)], ruleName };
};

// The caller must invoke this only after the owner chooses to enable sharing.
// Windows supplies the administrator consent dialog; no elevation happens at
// import, startup, or during the unit tests, which inject the runner.
const enablePrivateFirewall = async (options, { platform = process.platform, run = execFile, systemRoot } = {}) => {
    if (platform !== "win32") throw new Error("Automatic store firewall setup is available on Windows only.");
    const command = buildFirewallCommand(options, { systemRoot });
    await new Promise((resolve, reject) => {
        run(command.file, command.args, { windowsHide: true, maxBuffer: 16384 }, (error) => {
            if (error) reject(new Error("Windows did not allow the store firewall change. Approve the Windows administrator prompt to enable sharing, or ask an administrator to allow Winstore on its private network port."));
            else resolve();
        });
    });
    return { enabled: true, ruleName: command.ruleName };
};

module.exports = { buildFirewallCommand, enablePrivateFirewall };
