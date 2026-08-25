// Runs on the JobRadar app origin. Copies the local-first data the user
// already owns (resume basics, answers, skills) into extension storage so
// fill.js can use it on application pages. Nothing leaves the browser.
(function () {
  function sync() {
    try {
      const raw = localStorage.getItem("jobradar.v1");
      if (!raw) return;
      const state = JSON.parse(raw);
      const profile = {
        basics: state.resume?.basics ?? {},
        answers: state.answers ?? [],
        skills: state.resume?.skills ?? [],
        syncedAt: new Date().toISOString(),
      };
      chrome.storage.local.set({ jobradar_profile: profile });
    } catch (e) {
      // Malformed state - do nothing rather than break the page.
    }
  }
  sync();
  window.addEventListener("focus", sync);
  setInterval(sync, 30000);
})();
