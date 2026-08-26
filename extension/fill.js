// JobRadar Assist - autofills job application forms from the user's own
// JobRadar data. It outlines every field it touches and NEVER submits:
// the human reviews, attaches their resume, and clicks Submit themselves.
(function () {
  "use strict";

  // Re-injection (popup "Fill form on this page") must not stack observers.
  if (window.__jobradarAssist) {
    window.__jobradarAssist.run();
    return;
  }

  const FIELD_SELECTOR =
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea, select';

  // ---- matching: label/attribute text -> value from the user's profile ----
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
      { re: /given[-\s]?name|first[-\s]?name|\bfname\b/i, value: firstName },
      { re: /family[-\s]?name|last[-\s]?name|surname|\blname\b/i, value: lastName },
      { re: /full[-\s]?name|your\s*name|^name$|\bname\b/i, value: name },
      { re: /e-?mail/i, value: b.email || "" },
      { re: /phone|mobile|\btel\b/i, value: b.phone || "" },
      { re: /linkedin/i, value: link("linkedin") },
      { re: /github/i, value: link("github") },
      { re: /portfolio|personal\s*(site|website)|website|\burl\b/i, value: link("portfolio") || link("website") },
      { re: /current\s*(location|city)|^city$|address.*city|where.*(based|located)|^location/i, value: b.location || "" },
      { re: /sponsor/i, value: answer(/sponsor/i) },
      { re: /authoriz|legally\s+(able|allowed)|right\s+to\s+work|work\s+permit|eligible\s+to\s+work/i, value: answer(/authoriz/i) },
      { re: /notice\s*period|start\s*date|when.*start|availability|available\s*to\s*start/i, value: answer(/notice|start/i) },
      { re: /salary|compensation|pay\s*expectation|expected\s*(pay|ctc)|desired\s*pay/i, value: answer(/salary/i) },
      { re: /years?\s*(of)?\s*(relevant|total)?\s*experience/i, value: answer(/experience/i) },
      { re: /reloc/i, value: answer(/reloc/i) },
    ];
  }

  // ---- where a field's meaning can be found ----
  function labelTextFor(el) {
    const root = el.getRootNode ? el.getRootNode() : document;
    const scope = root.querySelector ? root : document;

    // Strong signals first: an explicit association or the field's own
    // attributes. These are unambiguous, so when one exists we use only those.
    const strong = [];
    if (el.id) {
      const lab = scope.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) strong.push(lab.textContent || "");
    }
    const wrap = el.closest("label");
    if (wrap) strong.push(wrap.textContent || "");
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = scope.getElementById ? scope.getElementById(id) : null;
        if (node) strong.push(node.textContent || "");
      }
    }
    for (const attr of ["aria-label", "placeholder", "autocomplete",
                        "data-automation-id", "data-qa", "data-testid", "name", "id"]) {
      const v = el.getAttribute(attr);
      if (v) strong.push(v);
    }
    if (strong.length > 0) return strong.join(" ").slice(0, 400);

    // Weak fallback: a label sitting in an ancestor. Only trustworthy when that
    // ancestor holds exactly one field - otherwise the first label in a shared
    // container would be applied to every field inside it.
    let container = el.parentNode;
    for (let depth = 0; container && depth < 4; depth++, container = container.parentNode) {
      if (!container.querySelector) continue;
      if (container.querySelectorAll(FIELD_SELECTOR).length !== 1) continue;
      const lab = container.querySelector("label, .label, [class*='label' i]");
      if (lab && lab.textContent) return lab.textContent.slice(0, 400);
    }
    return "";
  }

  // React-controlled inputs ignore plain .value writes; use the native setter.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function fillSelect(el, value) {
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

  const filledFields = new WeakSet();

  /**
   * Collect fields from the document, any open shadow roots (web-component
   * based ATS forms), and same-origin iframes. Cross-origin iframes are
   * unreachable from here by design - the manifest's all_frames handles those.
   */
  function collectFields(root = document, depth = 0) {
    const out = [];
    if (depth > 4) return out;
    try {
      out.push(...root.querySelectorAll(FIELD_SELECTOR));
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) out.push(...collectFields(el.shadowRoot, depth + 1));
      }
      if (root === document) {
        for (const frame of document.querySelectorAll("iframe")) {
          try {
            const doc = frame.contentDocument;
            if (doc) out.push(...collectFields(doc, depth + 1));
          } catch {
            // Cross-origin frame - the content script runs inside it instead.
          }
        }
      }
    } catch {
      // Defensive: a hostile or detached root must never break the fill.
    }
    return out;
  }

  let lastScan = { fields: 0, editable: 0, labels: [] };

  function fillPage(profile) {
    const matchers = buildMatchers(profile);
    const fields = collectFields();
    lastScan = { fields: fields.length, editable: 0, labels: [] };
    let filled = 0;
    for (const el of fields) {
      if (el.disabled || el.readOnly || filledFields.has(el)) continue;
      if (el.offsetParent === null && el.type !== "hidden") continue; // skip hidden fields
      lastScan.editable++;
      if (!(el instanceof HTMLSelectElement) && el.value.trim()) continue; // never overwrite
      const label = labelTextFor(el);
      lastScan.labels.push(label.replace(/\s+/g, " ").trim().slice(0, 80));
      const hit = matchers.find((m) => m.re.test(label) && m.value);
      if (!hit) continue;
      if (el instanceof HTMLSelectElement) {
        if (!el.value && fillSelect(el, hit.value)) { mark(el); filled++; }
      } else {
        setNativeValue(el, hit.value);
        mark(el);
        filled++;
      }
    }
    return filled;
  }

  function mark(el) {
    filledFields.add(el);
    el.style.outline = "2px solid #4f46e5";
    el.style.outlineOffset = "1px";
  }

  // ---- user-facing banner (top frame only, so iframes don't stack banners) ----
  function banner(message) {
    if (window.top !== window.self) return;
    let bar = document.getElementById("jobradar-assist-banner");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "jobradar-assist-banner";
      bar.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1f2937;color:#fff;" +
        "padding:11px 16px;border-radius:10px;font:13px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.35);" +
        "max-width:420px;line-height:1.45";
      document.documentElement.appendChild(bar);
    }
    bar.textContent = message;
    clearTimeout(bar._t);
    bar._t = setTimeout(() => bar.remove(), 10000);
  }

  // ---- run: fill now, then keep watching briefly for late-rendered forms ----
  let profileCache = null;
  let totalFilled = 0;
  let observer = null;

  function applyAndReport(profile, announce) {
    const n = fillPage(profile);
    totalFilled += n;
    if (announce) {
      if (totalFilled > 0) {
        banner(`JobRadar filled ${totalFilled} field${totalFilled === 1 ? "" : "s"} (outlined). Review them, attach your resume, and submit yourself.`);
      } else if (lastScan.editable === 0) {
        banner("No form fields on this page - this looks like the job description, not the application form. Click Apply, then click the JobRadar icon again.");
      } else {
        banner(`Found ${lastScan.editable} field${lastScan.editable === 1 ? "" : "s"} but recognized none of them. Click the JobRadar icon -> Copy diagnostics to report this page.`);
      }
    }
    return n;
  }

  function watchForLateFields(profile) {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      const n = fillPage(profile);
      if (n > 0) {
        totalFilled += n;
        banner(`JobRadar filled ${totalFilled} field${totalFilled === 1 ? "" : "s"} (outlined). Review them, attach your resume, and submit yourself.`);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Single-page application forms settle within seconds; stop watching after that.
    setTimeout(() => observer && observer.disconnect(), 20000);
  }

  function run() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get("jobradar_profile", (data) => {
      const profile = data.jobradar_profile;
      if (!profile) {
        banner("JobRadar has no data yet - open the JobRadar app once in this browser, then click Fill again.");
        return;
      }
      profileCache = profile;
      applyAndReport(profile, true);
      watchForLateFields(profile);
    });
  }

  function diagnose() {
    return {
      url: location.href,
      frame: window.top === window.self ? "top" : "iframe",
      fieldsFound: lastScan.fields,
      editableFields: lastScan.editable,
      filled: totalFilled,
      labelsSeen: lastScan.labels.slice(0, 25),
    };
  }

  window.__jobradarAssist = { run, fillPage, diagnose };
  window.__jobradarFill = fillPage; // test hook used by the fixture suite

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    run();
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg === "jobradar-fill") {
        totalFilled = 0;
        if (profileCache) { applyAndReport(profileCache, true); watchForLateFields(profileCache); }
        else run();
      }
    });
  }
})();
