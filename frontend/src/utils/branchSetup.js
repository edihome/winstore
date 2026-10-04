export function buildBranchPayload(form, { editing = false } = {}) {
  const name = typeof form.name === "string" ? form.name.trim() : "";
  if (!name) throw new Error("Branch name is required.");
  if (name.length > 255) throw new Error("Branch name cannot exceed 255 characters.");
  const payload = { name, isHeadquarters: form.isHeadquarters === true };
  // The server generates a short reference for a new branch. Existing
  // references remain editable without being confused with setup credentials.
  if (editing) {
    const code = typeof form.code === "string" ? form.code.trim() : "";
    if (!code) throw new Error("Branch reference is required.");
    payload.code = code;
  }
  return payload;
}

export function readBranchSetupCode(result) {
  if (typeof result?.setupCode !== "string" || !result.setupCode.trim()) return null;
  return {
    setupCode: result.setupCode.trim(),
    expiresAt: result.setupCodeExpiresAt || result.expiresAt || null,
    branchId: result.branchId || result.id || null,
  };
}

export function buildBranchLinkPayload(setupCode) {
  if (typeof setupCode !== "string" || !setupCode.trim()) {
    throw new Error("Enter the branch setup code from head office.");
  }
  // Treat the complete code as opaque. The branch server validates it and
  // resolves head office, so setup never depends on a second URL input.
  return { setupCode: setupCode.trim() };
}

export function buildEnrollmentCodePayload(branchId, name = "") {
  if (typeof branchId !== "string" || !branchId.trim()) {
    throw new Error("Choose the branch this desktop will use.");
  }
  return { branchId: branchId.trim(), name: typeof name === "string" ? name.trim() || undefined : undefined };
}
