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
  if (tab?.id) chrome.tabs.sendMessage(tab.id, "jobradar-fill");
  window.close();
});
