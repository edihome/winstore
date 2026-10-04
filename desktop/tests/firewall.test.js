const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFirewallCommand, enablePrivateFirewall } = require("../src/firewall");

const settings = { executablePath: "C:\\Program Files\\Winstore\\Winstore.exe", address: "192.168.1.12" };

const scripts = (command) => {
    const launcher = Buffer.from(command.args[3], "base64").toString("utf16le");
    const encoded = launcher.match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1];
    return { launcher, elevated: Buffer.from(encoded, "base64").toString("utf16le") };
};

test("the elevated firewall change is scoped to the executable, private subnet and one TLS port", () => {
    const command = buildFirewallCommand(settings);
    const { launcher, elevated } = scripts(command);
    assert.match(launcher, /-Verb RunAs -WindowStyle Hidden -Wait/);
    assert.match(elevated, /Profile = 'Private'/);
    assert.match(elevated, /RemoteAddress = 'LocalSubnet'/);
    assert.match(elevated, /LocalAddress = '192\.168\.1\.12'/);
    assert.match(elevated, /LocalPort = '51124'/);
    assert.match(elevated, /Protocol = 'TCP'/);
    assert.ok(elevated.includes("Program = 'C:\\Program Files\\Winstore\\Winstore.exe'"));
    assert.doesNotMatch(elevated, /54329|51123|Profile = 'Any'/);
});

test("executable paths remain literal PowerShell strings", () => {
    const command = buildFirewallCommand({ executablePath: "C:\\Winstore's $(Unsafe)\\Winstore.exe" });
    assert.ok(scripts(command).elevated.includes("Program = 'C:\\Winstore''s $(Unsafe)\\Winstore.exe'"));
    for (const executablePath of ["relative.exe", "\\\\server\\Winstore.exe", "\\Winstore.exe", "C:\\bad\nWinstore.exe"]) {
        assert.throws(() => buildFirewallCommand({ executablePath }), /absolute path/);
    }
    assert.throws(() => buildFirewallCommand({ ...settings, address: "8.8.8.8" }), /private IPv4/);
});

test("only an explicit invocation launches the injected native elevation runner", async () => {
    const calls = [];
    const result = await enablePrivateFirewall(settings, {
        platform: "win32",
        run: (file, args, options, callback) => { calls.push({ file, args, options }); callback(null); },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(result.enabled, true);
    await assert.rejects(enablePrivateFirewall(settings, {
        platform: "win32", run: (_file, _args, _options, callback) => callback(new Error("UAC rejected")),
    }), /administrator prompt/);
    await assert.rejects(enablePrivateFirewall(settings, { platform: "linux" }), /Windows only/);
});
