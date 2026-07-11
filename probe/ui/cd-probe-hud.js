// cd-probe-hud.js
//
// ON-SCREEN output for the probe. The player has no dev console and does not read
// UI.log, so every meaningful probe line is ALSO painted into a fixed overlay panel
// injected straight into the game's Gameface DOM (the base UI itself uses
// document.createElement thousands of times, so a UIScript can append to document.body).
//
// Everything here is best-effort and guarded: if the DOM isn't ready yet (cold start
// injects HTML late) it retries on the next animation frame; if there is no DOM at all
// it silently no-ops so the log path still works. Gameface-safe styling only: hex
// colors + flex, never hsl()/grid (per the repo UI gotchas).

const MAX_LINES = 28;
let _panel = null;
let _body = null;
let _lines = [];
// Multiple pinned headlines, keyed so independent stages (codex vs outer-tiles) each keep
// their own line instead of clobbering one another. Insertion order preserved.
let _verdicts = {};
// Last toasted text per key, so re-running a stage every turn only toasts when the verdict
// actually CHANGES (no per-turn notification spam).
let _lastToast = {};

function raf(fn) {
  try {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
  } catch (_) { /* fall through */ }
  try { return setTimeout(fn, 100); } catch (_) { return null; }
}

// Create the overlay once <body> exists. Returns the body element or null.
function ensurePanel() {
  try {
    if (typeof document === "undefined" || !document || !document.body) return null;
    if (_panel && _panel.isConnected) return _body;

    const panel = document.createElement("div");
    panel.id = "cd-probe-hud";
    panel.setAttribute("style", [
      "position:fixed", "top:14px", "right:14px", "z-index:2147483647",
      "width:560px", "max-width:46vw", "max-height:80vh", "overflow:hidden",
      "box-sizing:border-box", "padding:12px 14px",
      "background:#0b1020f2", "color:#e8f0ff",
      "border:2px solid #3f78ff", "border-radius:10px",
      "box-shadow:0 6px 24px #000000aa",
      "font-family:Consolas,monospace", "font-size:12px", "line-height:1.4",
      "pointer-events:none", "white-space:pre-wrap", "word-break:break-word",
    ].join(";"));

    const title = document.createElement("div");
    title.setAttribute("style", [
      "font-weight:bold", "font-size:13px", "color:#9dc0ff",
      "margin-bottom:6px", "border-bottom:1px solid #3f78ff66", "padding-bottom:5px",
    ].join(";"));
    title.textContent = "CULTURAL DIFFUSION PROBE";

    const verdict = document.createElement("div");
    verdict.id = "cd-probe-hud-verdict";
    verdict.setAttribute("style", [
      "font-weight:bold", "font-size:13px", "color:#ffd23f",
      "margin:2px 0 8px 0", "min-height:0",
    ].join(";"));

    const body = document.createElement("div");
    body.id = "cd-probe-hud-body";
    body.setAttribute("style", "color:#c9d8f0;");

    panel.appendChild(title);
    panel.appendChild(verdict);
    panel.appendChild(body);
    document.body.appendChild(panel);

    _panel = panel;
    _body = body;
    return body;
  } catch (_) {
    return null;
  }
}

function render() {
  const body = ensurePanel();
  if (!body) { raf(render); return; }
  try {
    const v = document.getElementById("cd-probe-hud-verdict");
    if (v) {
      const pinned = Object.keys(_verdicts).map((k) => "★ " + _verdicts[k]);
      v.textContent = pinned.length ? pinned.join("\n") : "running…";
    }
    body.textContent = _lines.join("\n");
  } catch (_) { /* ignore */ }
}

// Best-effort in-game notification/toast so the VERDICT pops even if the overlay is
// somehow not visible (e.g. a different DOM isolate).
function toast(text) {
  try {
    const g = /** @type {*} */ (globalThis);
    if (g.UI && typeof g.UI.sendNotification === "function") { g.UI.sendNotification(text); return; }
    if (g.engine && typeof g.engine.trigger === "function") g.engine.trigger("CulturalDiffusionProbeToast", { text });
  } catch (_) { /* ignore */ }
}

// Append one line to the on-screen panel.
export function hud(line) {
  try {
    _lines.push(String(line));
    while (_lines.length > MAX_LINES) _lines.shift();
    render();
  } catch (_) { /* ignore */ }
}

// Pin a headline verdict at the top of the panel AND fire a toast. `key` lets independent
// stages keep separate headlines (default "main" preserves single-line callers).
export function hudVerdict(line, key) {
  try {
    const k = key || "main";
    const text = String(line);
    _verdicts[k] = text;
    render();
    // Only toast when THIS key's verdict changed - the panel updates every turn, but a
    // notification should only pop on a real change (avoids per-turn spam from refreshes).
    if (_lastToast[k] !== text) { _lastToast[k] = text; toast(text); }
  } catch (_) { /* ignore */ }
}
