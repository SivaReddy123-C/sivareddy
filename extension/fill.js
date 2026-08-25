// JobRadar Assist - form filler for Greenhouse, Lever, and Ashby application
// pages. Fills from the user's own JobRadar data, highlights every field it
// touched, and NEVER submits: the human reviews and clicks Submit themselves.
(function () {
  "use strict";

  // ---- field matching dictionary: regex on the field's label/placeholder ----
  function buildMatchers(profile) {
    const b = profile.basics || {};
    const name = (b.name || "").trim();
    const firstName = name.split(/\s+/)[0] || "";
    const lastName = name.split(/\s+/).slice(1).join(" ") || "";
    const link = (label) =>
      (b.links || []).find((l) => (l.label || "").toLowerCase().includes(label))?.url || "";
    const answer = (re) =>
      (profile.answers || []).find((a) => re.test(a.label || ""))?.value || "";

    return [
      { re: /first\s*name|given\s*name/i, value: firstName },
      { re: /last\s*name|family\s*name|surname/i, value: lastName },
      { re: /full\s*name|your\s*name|^name\b/i, value: name },
      { re: /e-?mail/i, value: b.email || "" },
      { re: /phone|mobile/i, value: b.phone || "" },
      { re: /linkedin/i, value: link("linkedin") },
      { re: /github/i, value: link("github") },
      { re: /portfolio|website|personal\s*site|\burl\b/i, value: link("portfolio") || link("website") },
      { re: /current\s*(location|city)|^location|where.*(based|located)/i, value: b.location || "" },
      { re: /current\s*(company|employer)|^company\b|organization/i, value: "" },
      { re: /sponsor/i, value: answer(/sponsor/i) },
      { re: /authoriz|legally\s+(able|allowed)|right\s+to\s+work|work\s+permit/i, value: answer(/authoriz/i) },
      { re: /notice\s*period|start\s*date|when.*start|available/i, value: answer(/notice|start/i) },
      { re: /salary|compensation|pay\s*expectation|expected\s*(pay|ctc)/i, value: answer(/salary/i) },
      { re: /years?\s*(of)?\s*(relevant)?\s*experience/i, value: answer(/experience/i) },
      { re: /reloc/i, value: answer(/reloc/i) },
      { re: /pronoun/i, value: "" },
    ];
  }

  // ---- label discovery for an input ----
  function labelTextFor(el) {
    const parts = [];
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) parts.push(lab.textContent || "");
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent || "");
    parts.push(el.getAttribute("aria-label") || "");
    parts.push(el.getAttribute("placeholder") || "");
    parts.push(el.name || "", el.id || "");
    // Ashby/react forms: label often a sibling/ancestor div
    const container = el.closest("div");
    if (container) {
      const lab = container.querySelector("label, .label, [class*='label' i]");
      if (lab && lab.textContent) parts.push(lab.textContent);
    }
    return parts.join(" ").slice(0, 300);
  }

  // React-controlled inputs ignore .value writes; use the native setter + events.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(el) {
    el.style.outline = "2px solid #1f6feb";
    el.style.outlineOffset = "1px";
  }

  function fillSelect(el, value) {
    // Only fill selects for confident yes/no answers.
    const v = value.trim().toLowerCase();
    const lead = v.startsWith("yes") ? "yes" : v.startsWith("no") ? "no" : null;
    if (!lead) return false;
    for (const opt of el.options) {
      if ((opt.textContent || "").trim().toLowerCase().startsWith(lead)) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function fillPage(profile) {
    const matchers = buildMatchers(profile);
    const fields = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea, select',
    );
    let filled = 0;
    for (const el of fields) {
      if (el.disabled || el.readOnly) continue;
      if (el instanceof HTMLInputElement && el.value.trim()) continue; // never overwrite
      const label = labelTextFor(el);
      const hit = matchers.find((m) => m.re.test(label) && m.value);
      if (!hit) continue;
      if (el instanceof HTMLSelectElement) {
        if (fillSelect(el, hit.value)) { highlight(el); filled++; }
      } else {
        setNativeValue(el, hit.value);
        highlight(el);
        filled++;
      }
    }
    banner(filled);
    return filled;
  }

  function banner(filled) {
    let bar = document.getElementById("jobradar-assist-banner");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "jobradar-assist-banner";
      bar.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1f2937;color:#fff;" +
        "padding:10px 16px;border-radius:8px;font:13px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3);" +
        "display:flex;gap:12px;align-items:center";
      document.body.appendChild(bar);
    }
    bar.textContent = filled > 0
      ? `JobRadar filled ${filled} field${filled === 1 ? "" : "s"} (blue outline) — review everything, attach your resume, then submit yourself.`
      : "JobRadar: no fillable fields recognized on this page yet — open the application form and click Fill again.";
    const btn = document.createElement("button");
    btn.textContent = "Fill again";
    btn.style.cssText = "background:#1f6feb;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font:12px system-ui";
    btn.onclick = () => start();
    bar.appendChild(btn);
    clearTimeout(bar._t);
    bar._t = setTimeout(() => bar.remove(), 12000);
  }

  function start() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get("jobradar_profile", (data) => {
        if (data.jobradar_profile) fillPage(data.jobradar_profile);
        else banner(0);
      });
    }
  }

  // Test hook: fixtures call this directly with a profile object.
  window.__jobradarFill = fillPage;

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    // Give SPA forms a moment to render, then fill once; popup can re-trigger.
    setTimeout(start, 1500);
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg === "jobradar-fill") start();
    });
  }
})();
