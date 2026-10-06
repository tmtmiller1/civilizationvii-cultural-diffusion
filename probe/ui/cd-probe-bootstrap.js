// cd-probe-bootstrap.js, game scope.
//
// Runs the feasibility probe without a dev console (the in-game console is missing on
// many Mac setups). Each turn, and shortly after load, it ticks the state machine in
// cd-probe-runner.js: diagnostics, then the flip tests once a frontier plot exists, then
// the persistence re-check on the session after a save and reload. A persisted phase
// keeps it from flipping again. PlotOwnershipChanged is logged as the engine's own
// evidence of Q-FLIP. `globalThis.cd_probe` is exposed for anyone with a console.

import { emitLine } from "./cd-probe-emit.js";
import { api, autoRun } from "./cd-probe-runner.js";

let retries = 0;
const MAX_RETRIES = 40; // keep trying across turns until the map yields a candidate

function tick(why) {
  try {
    const r = autoRun(why);
    // still hunting for a candidate: try again later
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
  // the engine's own ownership-change event, logged alongside the probe's reads
  try {
    eng.on("PlotOwnershipChanged", (d) => {
      const x = d?.location?.x ?? d?.x ?? "?";
      const y = d?.location?.y ?? d?.y ?? "?";
      emitLine(`event: PlotOwnershipChanged (${x},${y}) owner=${d?.owner ?? "?"}`);
    });
  } catch (_) {}
  // Phase 5: the engine fires CityTransfered when a settlement changes owner. Keep every one
  // on globalThis so the revolt watch can match it to its exact target (fromPlayer + cityID)
  // instead of guessing from a laggy plot-owner read.
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

// console surface; nothing in the probe depends on it
try {
  const g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : null);
  if (g) {
    g.cd_probe = api;
    g.emigrationDiffusionProbe = api; // discoverable alias
    emitLine("bootstrap: console API also available (optional): cd_probe.auto(), cd_probe.diag(), "
      + "cd_probe.candidates(), cd_probe.reset()");
  }
} catch (e) { emitLine(`bootstrap: console attach failed ${String(e)}`); }

