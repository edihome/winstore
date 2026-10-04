import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import ConfirmAction from "./ConfirmAction";

const ACCENT_STYLE = { "--card-accent": "var(--color-teal)", "--card-glow": "rgba(38, 109, 104, 0.3)" };

export default function StoreSharing() {
  const { user, token } = useAuth();
  const desktop = window.winstoreDesktop;
  const available = desktop?.isDesktop === true && typeof desktop.getSharingStatus === "function";
  const isClient = available && desktop.role === "client";
  const isOwner = user?.role === "super_admin" || user?.role === "developer";
  const visible = available && (isClient || isOwner);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [connectionCode, setConnectionCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");

  const acceptStatus = useCallback((next) => {
    if (!next || typeof next.enabled !== "boolean" || !["host", "client"].includes(next.role)) {
      throw new Error("Unable to read this PC's store connection status. Please try again.");
    }
    setStatus(next);
    if (!next.enabled) {
      setConnectionCode("");
      setCopied(false);
    }
    if (next.error) setError(next.error);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    desktop.getSharingStatus()
      .then((next) => { if (!cancelled) acceptStatus(next); })
      .catch((err) => { if (!cancelled) setError(err.message || "Unable to read the store connection status."); });
    return () => { cancelled = true; };
  }, [visible, desktop, acceptStatus]);

  const runAction = async (name, action) => {
    if (busy) return;
    setBusy(name);
    setError("");
    setCopied(false);
    try {
      await action();
    } catch (err) {
      setError(err.message || "Unable to update the store connection. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const showConnectionCode = () => runAction("code", async () => {
    const code = await desktop.getConnectionCode(token);
    if (typeof code !== "string" || !code.trim()) throw new Error("The host did not return a connection code. Please try again.");
    setConnectionCode(code);
  });

  const copyConnectionCode = () => runAction("copy", async () => {
    try {
      await navigator.clipboard.writeText(connectionCode);
      setCopied(true);
    } catch {
      throw new Error("Copy is unavailable. Select the connection code and copy it manually.");
    }
  });

  if (!visible) return null;

  const addresses = status?.addresses || [];
  const networkAddress = addresses.some((entry) => entry.address === selectedAddress)
    ? selectedAddress
    : addresses[0]?.address || "";

  return (
    <section className="ledger-card mt-6 space-y-4 py-6 pr-6" style={ACCENT_STYLE} aria-labelledby="store-sharing-title">
      <div>
        <span className="field-label text-teal">This PC</span>
        <h3 id="store-sharing-title" className="mt-1 font-display text-lg font-semibold text-ink">
          {isClient ? "Store connection" : "Host this store"}
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          {isClient
            ? "This PC uses the host's shared stock, sales, and staff accounts."
            : "Let other PCs in this store connect to this PC's shared stock, sales, and staff accounts."}
        </p>
      </div>

      {error && <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>}

      {!status ? (
        <div>
          {!error && <p role="status" className="text-sm text-ink-soft">Checking store connection...</p>}
          {error && <button type="button" disabled={Boolean(busy)} onClick={() => runAction("refresh", async () => acceptStatus(await desktop.getSharingStatus()))} className="btn-chip btn-chip-neutral">Retry</button>}
        </div>
      ) : isClient ? (
        <>
          <dl className="text-sm text-ink">
            {status.storeName && <div><dt className="inline text-ink-soft">Store: </dt><dd className="inline">{status.storeName}</dd></div>}
            {status.address && <div className="mt-1"><dt className="inline text-ink-soft">Host: </dt><dd className="inline break-all font-mono text-xs">{status.address}</dd></div>}
          </dl>
          <p className="text-sm text-ink-soft">Checkout needs the host PC and local network to stay running. Internet can be unavailable while your store works locally.</p>
          <ConfirmAction
            label="Change connection"
            title="Change store connection?"
            prompt="You will leave this store and return to connection setup. Finish any current work before continuing."
            onConfirm={() => runAction("connection", () => desktop.changeConnection())}
            disabled={Boolean(busy)}
            className="btn-chip btn-chip-neutral"
          />
        </>
      ) : (
        <>
          <p role="status" className="text-sm font-medium text-ink">
            {status.enabled ? "Sharing is enabled for other PCs in this store." : "Sharing is off. This PC works on its own."}
          </p>
          <p className="text-sm text-ink-soft">
            Keep this host PC and the local network running for connected tills. When sharing is enabled, closing the window keeps Winstore running in the system tray. Internet is only needed for online services and head-office synchronization.
          </p>
          {!status.enabled && addresses.length > 1 && <div>
            <label htmlFor="store-network-address" className="field-label mb-1 block">Store network</label>
            <select
              id="store-network-address"
              value={networkAddress}
              disabled={Boolean(busy)}
              onChange={(event) => setSelectedAddress(event.target.value)}
              className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal sm:max-w-md"
            >
              {addresses.map((entry) => <option key={entry.address} value={entry.address}>{entry.name ? `${entry.name} — ` : ""}{entry.address}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink-soft">Choose the network used by the other PCs in this store.</p>
          </div>}
          {status.enabled ? (
            <>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={Boolean(busy)} onClick={showConnectionCode} className="btn-solid btn-solid-primary btn-solid-sm">
                  {busy === "code" ? "Getting code..." : "Show connection code"}
                </button>
                <ConfirmAction
                  label="Stop sharing"
                  title="Stop store sharing?"
                  prompt="Connected tills will lose access and cannot continue checkout until sharing starts again. This PC can continue working."
                  onConfirm={() => runAction("stop", async () => acceptStatus(await desktop.disableSharing(token)))}
                  disabled={Boolean(busy)}
                  className="btn-chip btn-chip-danger"
                />
              </div>
              {connectionCode && <div>
                <label htmlFor="store-connection-code" className="field-label mb-1 block">Store connection code</label>
                <textarea
                  id="store-connection-code"
                  readOnly
                  rows={4}
                  value={connectionCode}
                  spellCheck={false}
                  onFocus={(event) => event.target.select()}
                  className="w-full resize-none rounded border border-paper-line bg-paper px-3 py-2 font-mono text-xs text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button type="button" disabled={Boolean(busy)} onClick={copyConnectionCode} className="btn-chip btn-chip-primary">{copied ? "Copied" : "Copy connection code"}</button>
                  <button type="button" onClick={() => { setConnectionCode(""); setCopied(false); }} className="btn-link btn-link-neutral">Hide code</button>
                </div>
                <p className="mt-2 text-sm text-ink-soft">On each other PC, open Winstore, choose Connect to this store, and paste this code. Share it only with staff setting up your tills.</p>
              </div>}
            </>
          ) : (
            <button type="button" disabled={Boolean(busy)} onClick={() => runAction("enable", async () => acceptStatus(await desktop.enableSharing(token, networkAddress || undefined)))} className="btn-solid btn-solid-primary btn-solid-sm">
              {busy === "enable" ? "Starting sharing..." : "Enable store sharing"}
            </button>
          )}
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={Boolean(status.autoStart)}
              disabled={Boolean(busy)}
              onChange={(event) => {
                const enabled = event.target.checked;
                runAction("startup", async () => acceptStatus(await desktop.setAutoStart(token, enabled)));
              }}
              className="mt-1"
            />
            <span>Start Winstore at Windows sign-in<span className="mt-1 block text-xs text-ink-soft">Connected tills become available after someone signs in to Windows on this host PC.</span></span>
          </label>
        </>
      )}
    </section>
  );
}
