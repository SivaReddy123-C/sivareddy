chrome.storage.local.get("jobradar_profile", (data) => {
  const s = document.getElementById("status");
  if (data.jobradar_profile) {
    const p = data.jobradar_profile;
    s.textContent = `Data synced for ${p.basics?.name || "you"} (${new Date(p.syncedAt).toLocaleString()})`;
  } else {
    s.textContent = "No data yet — open the JobRadar app once, then come back.";
  }
});
document.getElementById("fill").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    // Content script already present (Greenhouse/Lever/Ashby pages).
    await chrome.tabs.sendMessage(tab.id, "jobradar-fill");
  } catch {
    // Any other site: inject on demand (activeTab grants access on this click).
    // fill.js self-starts after injection. Works on any application form -
    // found the job on LinkedIn or Dice? Land on the form, click Fill.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["fill.js"] });
  }
  window.close();
});

document.getElementById("diag").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => (window.__jobradarAssist ? window.__jobradarAssist.diagnose() : { note: "not loaded in this frame" }),
  });
  const report = JSON.stringify(results.map((r) => r.result), null, 1);
  await navigator.clipboard.writeText(report);
  document.getElementById("status").textContent = "Diagnostics copied to clipboard - paste them to report the page.";
});
