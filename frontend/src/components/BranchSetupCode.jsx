import { useState } from "react";
import { useFormat } from "../utils/format";

export default function BranchSetupCode({ issued, branchName }) {
  const { dateTime } = useFormat();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const copyCode = async () => {
    setCopyError("");
    setCopied(false);
    try {
      await navigator.clipboard.writeText(issued.setupCode);
      setCopied(true);
    } catch {
      setCopyError("Copy is unavailable here. Select the code below and copy it manually.");
    }
  };

  return (
    <div className="space-y-4">
      <p role="status" className="rounded border border-teal/30 bg-teal-soft px-3 py-2 text-sm text-ink">
        {branchName ? `${branchName} is ready for desktop setup.` : "Your branch setup code is ready."}
      </p>
      <div>
        <label htmlFor="branch-setup-code" className="field-label mb-1 block">Branch setup code</label>
        <textarea
          id="branch-setup-code"
          readOnly
          rows={5}
          value={issued.setupCode}
          spellCheck={false}
          onFocus={(event) => event.target.select()}
          className="w-full resize-none rounded border border-paper-line bg-paper px-3 py-2 font-mono text-xs text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
        />
        <button type="button" onClick={copyCode} className="btn-solid btn-solid-primary btn-solid-sm mt-2">
          {copied ? "Copied" : "Copy setup code"}
        </button>
        {copyError && <p role="alert" className="mt-2 text-sm text-clay">{copyError}</p>}
      </div>
      {issued.expiresAt && <p className="text-xs text-ink-soft">Expires {dateTime(issued.expiresAt)}. This code can be used once.</p>}
      <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
        <li>Connect the branch desktop to the internet and open Winstore.</li>
        <li>Paste this code into Branch setup code, then select Set up branch.</li>
        <li>Keep the app open until verification and the initial download finish, then sign in with your head-office account while still online.</li>
      </ol>
      <p className="text-sm text-ink-soft">After setup and your first online sign-in, the branch can work offline and sync when its internet connection returns. Each account needs its first sign-in on this device while online.</p>
    </div>
  );
}
