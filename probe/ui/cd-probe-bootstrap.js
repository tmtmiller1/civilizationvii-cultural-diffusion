// cd-probe-bootstrap.js - game scope.
//
// Wires the Cultural Diffusion feasibility probe to run FULLY AUTOMATICALLY - no
// dev console required (the in-game console is unavailable on many Mac setups).
//
//   1. On every turn (and shortly after load) it drives the auto-run state machine
//      in cd-probe-runner.js, which: emits read-only diagnostics, then, once a
//      frontier plot is available, performs the flip tests ONCE, then on the next
//      session (after the player saves & reloads) reports whether the flips
//      persisted. It self-throttles via a persisted phase, so it never spams flips.
//   2. Listens for PlotOwnershipChanged so the engine's own redraw event is logged
//      as independent proof of Q-FLIP.
//   3. Still exposes `globalThis.cd_probe` for anyone who DOES have a console, but
//      nothing depends on it.

import { emitLine } from "./cd-probe-emit.js";
import { api, autoRun } from "./cd-probe-runner.js";

let retries = 0;
const MAX_RETRIES = 40; // keep trying across turns until the map yields a candidate

function tick(why) {
  try {
    const r = autoRun(why);
    // While still hunting for a candidate, allow repeated attempts on later turns.
    if (r && r.phase === "init" && r.waiting) {
      retries += 1;
      if (retries <= MAX_RETRIES) {
        try { setTimeout(() => tick("retry"), 8000); } catch (_) {}
      }
    }
  } catch (e) { emitLine(`bootstrap: autoRun failed ${String(e)}`); }
}

emitLine("Probe attached. Watching this panel; it will auto-test frontier tiles and show the CODEX verdict here - no console needed.");

const eng = typeof engine !== "undefined" ? engine : null;
if (eng && typeof eng.on === "function") {
  try { eng.on("PlayerTurnActivated", () => tick("PlayerTurnActivated")); } catch (_) {}
  try { eng.on("LoadComplete", () => tick("LoadComplete")); } catch (_) {}
  // Independent Q-FLIP proof: log whenever the engine itself reports an ownership change.
  try {
    eng.on("PlotOwnershipChanged", (d) => {
      const x = d?.location?.x ?? d?.x ?? "?";
      const y = d?.location?.y ?? d?.y ?? "?";
      emitLine(`event: PlotOwnershipChanged (${x},${y}) owner=${d?.owner ?? "?"}`);
    });
  } catch (_) {}
  // Phase 5 independent confirmation: the engine fires CityTransfered when a settlement changes
  // owner. Record every one into globalThis so the revolt watch can match it to OUR exact target
  // (fromPlayer + cityID), instead of guessing from a laggy plot-owner read.
  try {
    eng.on("CityTransfered", (d) => {
      emitLine(`event: CityTransfered ${JSON.stringify(d || {})}`);
      try {
        const g = (typeof globalThis !== "undefined") ? globalThis : {};
        if (!g.__cdTransfers) g.__cdTransfers = [];
        g.__cdTransfers.push(d || {});
        while (g.__cdTransfers.length > 50) g.__cdTransfers.shift();
      } catch (_) {}
    });
  } catch (_) {}
}
// Kick off shortly after attach in case a turn is already active.
try { setTimeout(() => tick("timeout"), 6000); } catch (_) {}

// Console surface (optional - the probe does not need it).
try {
  const g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : null);
  if (g) {
    g.cd_probe = api;
    g.emigrationDiffusionProbe = api; // discoverable alias
    emitLine("bootstrap: console API also available (optional): cd_probe.auto(), cd_probe.diag(), "
      + "cd_probe.candidates(), cd_probe.reset()");
  }
} catch (e) { emitLine(`bootstrap: console attach failed ${String(e)}`); }

