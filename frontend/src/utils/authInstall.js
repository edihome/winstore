// Account creation is only available after this server confirms that it is
// not a branch installation. An unavailable setup probe must not grant it.
export function getAuthInstallPolicy(linkInfo, probeError = "", desktopRole = "") {
  if (probeError) return { stage: "unavailable", canRegister: false };
  if (linkInfo == null) return { stage: "checking", canRegister: false };
  if (
    typeof linkInfo !== "object" ||
    typeof linkInfo.branchInstall !== "boolean" ||
    typeof linkInfo.linked !== "boolean"
  ) {
    return { stage: "unavailable", canRegister: false };
  }
  if (linkInfo.branchInstall && !linkInfo.linked) {
    // Connected tills cannot enroll the host or create a second business.
    return { stage: desktopRole === "client" ? "unavailable" : "link", canRegister: false };
  }
  return { stage: "ready", canRegister: !linkInfo.branchInstall && desktopRole !== "client" };
}

export function getAuthMode(requestedMode, policy) {
  if (requestedMode === "register") return policy.canRegister ? "register" : "login";
  return requestedMode === "attendance" ? "attendance" : "login";
}
