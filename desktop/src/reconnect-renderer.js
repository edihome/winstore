const error = document.getElementById("error");
error.textContent = new URLSearchParams(location.search).get("message") || "The main store PC is unavailable.";
for (const [id, method] of [["retry", "reconnect"], ["change", "changeConnection"]]) {
    document.getElementById(id).addEventListener("click", async () => {
        const buttons = document.querySelectorAll("button");
        buttons.forEach((button) => { button.disabled = true; });
        error.textContent = "Checking connection…";
        try { await window.winstoreDesktop[method](); error.textContent = ""; }
        catch (failure) { error.textContent = failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""); }
        finally { buttons.forEach((button) => { button.disabled = false; }); }
    });
}
