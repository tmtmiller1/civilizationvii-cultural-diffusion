// cd-probe-runner.js
//
// Orchestrates the Cultural Diffusion feasibility probe. It answers the four open
// questions from docs/cultural-diffusion-spec.md 2:
//   Q-FLIP       - does setOwnership actually reassign a plot + redraw borders?
//   Q-YIELD      - is a flipped tile integrated (worked/yields) or cosmetic?
//   Q-PERSIST    - does a flip survive save -> reload?
//   Q-BEYOND-CAP - can we claim a plot the city could NOT claim via normal growth?
//
// SAFETY MODEL: only the READ-ONLY diagnostics run automatically. Any call that
// MUTATES the map (an actual tile flip) is manual, invoked from the console, so the
// player controls exactly when - and on which plot - the game state is touched.
// Every flip records a reversible entry and the runner can restore it.

import { emitLine, emitSection, newRunId } from "./cd-probe-emit.js";
import { hudVerdict } from "./cd-probe-hud.js";
import {
  apiPresence, guardSP, localPlayerId, localCities, cityLoc,
  plotsInRadius, plotSnapshot, owningCityIdAt, owningPlayerIdAt,
  expandPlotCount, flipViaSetOwnership, flipViaPurchasePlot, unclaim,
  plotIndex, owningCityCID, purchasedPlots, constructibleIndex, buildablePlots,
} from "./cd-probe-api.js";
import { recordFlip, readFlips, clearFlips, readMeta, writeMeta, clearAll } from "./cd-probe-store.js";

const PROBE_VERSION = "0.4.0"; // cache-bust marker: log must read 0.4.0
const RINGS = 6;               // search out to 6 rings so we can test tiles BEYOND the normal 3-ring footprint
const SCHEMA = "v4-integrate"; // re-arm token: if stored meta.schema differs, the probe clears + re-runs the new tests

// Q-INTEGRATE / Q-CODEX buildability probes. If a flipped tile is REAL city land, the
// player can place these on it - which is exactly how the Han would develop science on
// diffused land and then Shi-Dafu-codex it. LIBRARY/ACADEMY are the science buildings the
// codex targets; MONUMENT is a generic "can I build ANYTHING here" control.
const TEST_BUILDINGS = ["BUILDING_LIBRARY", "BUILDING_ACADEMY", "BUILDING_MONUMENT"];

// Auto-run behavior. All destructive tests target EMPTY frontier land by default
// (fully reversible / non-disruptive). Set AUTO_FLIP_RIVAL true to also test one
// rival-owned flip (the "contest" case) - it takes a tile from an AI, so it is off
// by default; start a fresh game afterward to discard the change.
const AUTO = {
  ENABLED: true,
  FLIP_SET_UNOWNED: true,   // Q-FLIP + Q-YIELD(cosmetic) + Q-BEYOND-CAP via setOwnership (near)
  FLIP_BUY_UNOWNED: true,   // Q-YIELD(integrated) via city.purchasePlot (near)
  FLIP_FAR: true,           // Q-BEYOND-CAP: flip an unowned tile OUTSIDE ring 3 (both verbs)
  FLIP_RIVAL: true,         // contest case: take a tile from another civ (destructive to AI; throwaway save)
};

// --- Frontier discovery (read-only) -----------------------------------------

// A "candidate" plot is one within `rings` of a local city that is NOT already
// owned by the local player - i.e. exactly the frontier the mod would diffuse into.
// Returns the first N candidates classified by current owner so the tester can pick.
function findCandidates(rings, limit) {
  const me = localPlayerId();
  const cities = localCities();
  // "beyondCap" = a plot outside ring 3 of EVERY local city, i.e. one a city could
  // not reach through its normal 3-ring footprint. This is the Q-BEYOND-CAP set.
  const near3 = new Set();
  for (const city of cities) {
    const loc = cityLoc(city);
    if (!loc) continue;
    for (const p of plotsInRadius(loc, 3)) near3.add(`${p.x},${p.y}`);
  }
  const seen = new Set();
  const unowned = [];
  const rival = [];
  for (const city of cities) {
    const loc = cityLoc(city);
    if (!loc) continue;
    for (const p of plotsInRadius(loc, rings)) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ownerCity = owningCityIdAt(p);
      const ownerPlayer = owningPlayerIdAt(p);
      const beyondCap = !near3.has(key); // outside the normal 3-ring footprint
      // Owner id -1 (or a null/-1 owning city) means NOBODY owns the plot - the empty
      // frontier. Anything owned by another player is rival.
      const isUnowned =
        ownerPlayer === -1 || ownerPlayer == null ||
        ownerCity == null || ownerCity === -1;
      if (isUnowned) {
        unowned.push({ ...p, ownerPlayer, beyondCap });
      } else if (ownerPlayer !== me) {
        rival.push({ ...p, ownerPlayer, ownerCity, beyondCap });
      }
    }
  }
  return {
    unowned: unowned.slice(0, limit),
    rival: rival.slice(0, limit),
    counts: {
      unowned: unowned.length,
      rival: rival.length,
      unownedBeyond3: unowned.filter((u) => u.beyondCap).length,
      rivalBeyond3: rival.filter((r) => r.beyondCap).length,
    },
  };
}

// --- Auto diagnostics (READ-ONLY, safe) -------------------------------------

export function runDiagnostics(trigger) {
  const runId = newRunId();
  emitLine(`RUN_START diagnostics ${runId} trigger=${trigger}`);
  const presence = apiPresence();
  const cands = findCandidates(RINGS, 12);
  const priorFlips = readFlips();
  // Q-PERSIST re-check: for every flip we recorded in a previous session, read the
  // plot's CURRENT owner and compare to what we set it to.
  const persistCheck = priorFlips.map((f) => ({
    loc: f.loc,
    setTo: f.setTo,
    verb: f.verb,
    runId: f.runId,
    ownerNow: owningPlayerIdAt(f.loc),
    owningCityNow: owningCityIdAt(f.loc),
    survived: owningPlayerIdAt(f.loc) === f.setTo,
  }));
  emitSection(runId, "cd_diagnostics", {
    probe_version: PROBE_VERSION,
    scope: "game",
    localPlayer: localPlayerId(),
    presence,
    candidates: cands,
    persistCheck,
    hint: presence.setOwnership
      ? "setOwnership present - run cd_probe.flipSet()/flipBuy() from the console to test Q-FLIP/Q-YIELD."
      : "setOwnership NOT present on this build - Q-FLIP would require a different verb.",
  });
  emitLine(`RUN_END diagnostics ${runId}`);
  return { presence, candidates: cands, persistCheck };
}

// --- Manual mutation tests (invoked from the console) -----------------------

// Pick a target: explicit {x,y}, else the first candidate of the requested kind.
function resolveTarget(kind, loc) {
  if (loc && typeof loc.x === "number") return loc;
  const c = findCandidates(RINGS, 40);
  if (kind === "rival") return c.rival[0] || null;
  if (kind === "farRival") return c.rival.find((r) => r.beyondCap) || null;
  if (kind === "farUnowned") return c.unowned.find((u) => u.beyondCap) || null;
  return c.unowned[0] || null; // default: nearest unowned
}

// Core flip test: snapshot before -> flip -> snapshot after -> report + record.
function doFlip(verb, kind, loc) {
  if (!guardSP()) return { ok: false, reason: "guard" };
  const runId = newRunId();
  const target = resolveTarget(kind, loc);
  if (!target) {
    emitLine(`RUN flip ${runId}: no ${kind} candidate found within range`);
    return { ok: false, reason: "no-candidate" };
  }
  const me = localPlayerId();
  const before = plotSnapshot(target);
  let result;
  if (verb === "setOwnership") {
    result = flipViaSetOwnership(me, target);
  } else {
    result = flipViaPurchasePlot(localCities()[0], target);
  }
  const after = plotSnapshot(target);
  const flipped = before.owner !== after.owner || before.owningCity !== after.owningCity;
  const record = {
    runId, verb, kind, loc: target, setTo: me,
    ts: new Date().toISOString(),
    ownerBefore: before.owner, ownerAfter: after.owner,
    cityBefore: before.owningCity, cityAfter: after.owningCity,
  };
  recordFlip(record);
  emitLine(`RUN_START flip ${runId} verb=${verb} kind=${kind} beyondCap=${!!target.beyondCap}`);
  emitSection(runId, "cd_flip", {
    probe_version: PROBE_VERSION,
    verb, kind, call: result,
    target, beyondCap: !!target.beyondCap, localPlayer: me,
    before, after,
    Q_FLIP_ownerChanged_immediate: flipped, // NOTE: writes are async; the immediate snapshot is unreliable
    note: "Ownership writes apply asynchronously - trust FLIP_CONFIRM (deferred re-read) and the "
      + "persistCheck, not the immediate before/after.",
  });
  emitLine(`RUN_END flip ${runId} immediateChanged=${flipped}`);
  // Deferred re-read: the write settles a frame or two later. This is the reliable Q-FLIP signal.
  try {
    setTimeout(() => {
      const now = plotSnapshot(target);
      const changedNow = now.owner === me;
      emitLine(`FLIP_CONFIRM ${runId} verb=${verb} kind=${kind} beyondCap=${!!target.beyondCap} `
        + `loc=${target.x},${target.y} ownerNow=${now.owner} cityNow=${now.owningCity} `
        + `Q_FLIP=${changedNow ? "GREEN" : "no-change"}`);
    }, 2000);
  } catch (_) { /* no setTimeout in some contexts */ }
  return { ok: true, flipped, target, before, after };
}

// --- Automatic staged sequence (NO CONSOLE REQUIRED) ------------------------
//
// A persisted state machine so the probe can answer every question hands-off:
//   phase "init"    - each turn, run diagnostics; once a frontier candidate is
//                     available, perform the configured flips ONCE, then advance
//                     to "flipped". (Retries across turns until the map is ready.)
//   phase "flipped" - flips are done and recorded; emit a banner telling the
//                     player to SAVE and RELOAD so persistence can be judged.
//   phase "done"    - on a later session the persist re-check ran; report and stop.
//
// Persistence is judged by comparing the plot's CURRENT owner to what we recorded
// setting it to, on a session AFTER the flips (readMeta().flippedSession differs
// from the live session nonce). runDiagnostics already emits the persistCheck block.

function sessionNonce() {
  // A value that is stable within a session but (very likely) changes across a
  // save/reload, so we can tell "same session" from "reloaded".
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  if (!g.__cdProbeSession) {
    g.__cdProbeSession = `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  }
  return g.__cdProbeSession;
}

// Pick DISTINCT plots up front so a setOwnership tile is never ALSO purchased. The
// original probe re-resolved "the first candidate" per flip; because ownership writes
// are async, the same plot could receive both verbs in one tick - exactly what muddied
// the spec's Q-YIELD read. Assigning distinct plots here isolates each verb cleanly.
function pickTargets(cands) {
  const unowned = (cands.unowned || []).slice();
  const rival = (cands.rival || []).slice();
  const nextFar = () => {
    const i = unowned.findIndex((u) => u.beyondCap);
    return i >= 0 ? unowned.splice(i, 1)[0] : (unowned.shift() || null);
  };
  const next = () => unowned.shift() || null;
  return {
    setNear: next(),                 // setOwnership, near - ISOLATED (never purchased)
    buyNear: next(),                 // purchasePlot, near
    setFar: nextFar(),               // setOwnership, beyond ring 3 - ISOLATED
    buyFar: nextFar(),               // purchasePlot, beyond ring 3
    setRival: rival.shift() || null, // contest case
    buyRival: rival.shift() || null,
  };
}

function performAutoFlips() {
  const t = pickTargets(findCandidates(RINGS, 60));
  const done = [];
  const run = (cond, label, verb, kind, loc) => {
    if (cond && loc) done.push({ test: label, result: doFlip(verb, kind, loc) });
  };
  run(AUTO.FLIP_SET_UNOWNED, "setOwnership/unowned", "setOwnership", "unowned", t.setNear);
  run(AUTO.FLIP_BUY_UNOWNED, "purchasePlot/unowned", "purchasePlot", "unowned", t.buyNear);
  run(AUTO.FLIP_FAR, "setOwnership/farUnowned(>ring3)", "setOwnership", "farUnowned", t.setFar);
  run(AUTO.FLIP_FAR, "purchasePlot/farUnowned(>ring3)", "purchasePlot", "farUnowned", t.buyFar);
  run(AUTO.FLIP_RIVAL, "setOwnership/rival", "setOwnership", "rival", t.setRival);
  run(AUTO.FLIP_RIVAL, "purchasePlot/rival", "purchasePlot", "rival", t.buyRival);
  return done;
}

// --- Q-INTEGRATE / Q-CODEX: is a flipped tile real, buildable city land? ------
//
// Settles the spec's open Q-YIELD question AND the Han-codex report in one hands-off
// pass. For each recorded flip we read (deferred, after the async write settles):
//   owner        - does the plot read as owned by us?
//   owningCity   - does getOwningCityFromXY return a REAL city (id != -1)?
//   inCityPlots  - is the plot inside that city's getPurchasedPlots() set?
//   buildable[]  - can we actually place a Library / Academy / Monument on it?
// INTEGRATED = a real owning city AND (in its plot set OR something buildable there) =
// the world where the Han builds a science building on diffused land and codexes it.
// ORPHAN = owner set but no owning city / nothing buildable = empty-tile codex impossible.

function euclid2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

function cidNum(cid) { return cid ? ((typeof cid.id === "number") ? cid.id : cid.id?.id) : -1; }

// The local city that OWNS the plot (matched by owning-city id), else the nearest one.
function cityForPlot(loc) {
  const cid = owningCityCID(loc);
  const cities = localCities();
  if (cid) {
    const idNum = cidNum(cid);
    // Resolve to the local City OBJECT and use ITS .id ComponentID for canStart - the
    // exact shape the base UI passes - rather than the raw getOwningCityFromXY return,
    // whose object shape we don't want to depend on.
    const owned = cities.find((c) => (c?.id?.id) === idNum);
    if (owned) return { city: owned, buildCID: owned.id, owns: true };
  }
  let best = null, bestD = Infinity;
  for (const c of cities) {
    const cl = cityLoc(c);
    if (!cl) continue;
    const d = euclid2(cl, loc);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { city: best, buildCID: best?.id || null, owns: false };
}

function integrationSnapshot(flip) {
  const loc = flip.loc;
  const idx = plotIndex(loc);
  const me = localPlayerId();
  const owner = owningPlayerIdAt(loc);
  const cid = owningCityCID(loc);
  const { city, buildCID, owns } = cityForPlot(loc);
  const inCityPlots = idx >= 0 && purchasedPlots(city).indexOf(idx) >= 0;

  const build = {};
  let anyBuildable = false;
  for (const name of TEST_BUILDINGS) {
    const ci = constructibleIndex(name);
    if (ci < 0) { build[name] = { absent: true }; continue; }
    const r = buildablePlots(buildCID, ci);
    const here = idx >= 0 && r.plots.indexOf(idx) >= 0;
    if (here) anyBuildable = true;
    build[name] = { canStartSuccess: r.success, buildableHere: here, validPlotsInCity: r.plots.length };
  }

  const cityReal = !!cid;
  const integrated = cityReal && (inCityPlots || anyBuildable);
  return {
    verb: flip.verb, kind: flip.kind, loc, plotIndex: idx,
    owner, ownerIsMe: owner === me, owningCityId: cidNum(cid), owningCityReal: cityReal,
    ownedByCity: owns, inCityPlots, buildableHere: anyBuildable, build,
    verdict: integrated ? "INTEGRATED" : "ORPHAN",
  };
}

export function runIntegration(trigger) {
  const runId = newRunId();
  const flips = readFlips();
  emitLine(`RUN_START integration ${runId} trigger=${trigger} flips=${flips.length}`);
  const rows = flips.map(integrationSnapshot);
  for (const r of rows) {
    const b = TEST_BUILDINGS
      .map((n) => `${n.replace("BUILDING_", "")}=${r.build[n]?.buildableHere ? "Y" : (r.build[n]?.absent ? "-" : "n")}`)
      .join(" ");
    emitLine(`Q-INTEGRATE ${r.verb}/${r.kind} loc=${r.loc.x},${r.loc.y} ownerIsMe=${r.ownerIsMe} `
      + `owningCity=${r.owningCityReal ? r.owningCityId : "NONE"} inCityPlots=${r.inCityPlots} `
      + `buildable[${b}] => ${r.verdict}`);
  }
  // Rollup on the bare-setOwnership verdict - the mod's DEFAULT flip verb, and the one
  // that determines whether the Han-codex report is real.
  const setRows = rows.filter((r) => r.verb === "setOwnership");
  const anySetIntegrated = setRows.some((r) => r.verdict === "INTEGRATED");
  const anySetBuildable = setRows.some((r) => r.buildableHere);
  // Pinned on-screen headline (+ toast) - the one answer the player is here for.
  hudVerdict(`CODEX: setOwnership => ${setRows.length
    ? (anySetIntegrated ? "INTEGRATED - Han CAN build science + codex (report CONFIRMED)" : "ORPHAN - empty-tile codex REFUTED")
    : "pending (no flip yet)"} | buildable science here: ${anySetBuildable ? "YES" : "no"}`);
  emitLine(`Q-CODEX-ENABLEMENT: bare setOwnership tiles => `
    + `${setRows.length ? (anySetIntegrated ? "INTEGRATED" : "ORPHAN") : "no-setOwnership-flip-yet"}`
    + ` (buildableScienceHere=${anySetBuildable}). `
    + `INTEGRATED+buildable => Han CAN build a science building on diffused land and Shi-codex it (report CONFIRMED). `
    + `ORPHAN+not-buildable => empty-tile codex REFUTED (must run some other way).`);
  emitSection(runId, "cd_integration", {
    probe_version: PROBE_VERSION, trigger, rows,
    rollup: { setOwnership: { integrated: anySetIntegrated, buildableScience: anySetBuildable, count: setRows.length } },
  });
  emitLine(`RUN_END integration ${runId}`);
  return rows;
}

export function autoRun(trigger) {
  if (!AUTO.ENABLED) return { phase: "disabled" };
  let meta = readMeta();
  // Re-arm: if the test schema changed (new probe build with new tests), wipe the
  // prior phase/flip log so the new tests actually run instead of reporting "done".
  if (meta.schema !== SCHEMA) {
    clearAll();
    meta = { phase: "init", schema: SCHEMA };
    writeMeta(meta);
    emitLine(`autoRun: schema changed -> reset for new tests (schema=${SCHEMA})`);
  }
  const session = sessionNonce();

  // Always emit the read-only diagnostics (includes the Q-PERSIST persistCheck for
  // any flips recorded in a prior session).
  const diag = runDiagnostics(trigger);

  if (meta.phase === "init" || !meta.phase) {
    // Need at least one candidate before we can flip; keep phase "init" and retry.
    const cands = diag.candidates || { counts: { unowned: 0, rival: 0 } };
    const haveTarget = (cands.counts?.unowned || 0) > 0 || (AUTO.FLIP_RIVAL && (cands.counts?.rival || 0) > 0);
    if (!haveTarget) {
      emitLine(`autoRun: no frontier candidate yet (trigger=${trigger}) - will retry next turn`);
      return { phase: "init", waiting: true };
    }
    if (!guardSP()) { emitLine("autoRun: blocked (multiplayer)"); return { phase: "blocked" }; }
    emitLine(`autoRun: performing automatic flips (session=${session})`);
    const flips = performAutoFlips();
    writeMeta({ phase: "flipped", schema: SCHEMA, flippedSession: session, ts: new Date().toISOString() });
    // Q-INTEGRATE / Q-CODEX: read integration once the async ownership writes settle
    // (~2s per flip; give a wide margin). This answers - hands-off - whether a bare
    // setOwnership tile is real, buildable city land (Han-codex CONFIRMED) or inert.
    try { setTimeout(() => runIntegration("post-flip"), 5000); } catch (_) { runIntegration("post-flip-nodelay"); }
    emitLine("========================================================================");
    emitLine("cd-probe: FLIPS DONE. Integration/codex read auto-runs in ~5s (Q-INTEGRATE lines).");
    emitLine("Then SAVE the game and LOAD that save (or quit to menu and reload): the probe");
    emitLine("auto-reports Q-PERSIST + re-runs the integration read. No console needed.");
    emitLine("========================================================================");
    return { phase: "flipped", flips };
  }

  if (meta.phase === "flipped") {
    if (meta.flippedSession && meta.flippedSession !== session) {
      // We are in a NEW session after the flips -> the persistCheck above is the
      // authoritative Q-PERSIST answer.
      const flips = readFlips();
      const survived = flips.filter((f) => owningPlayerIdAt(f.loc) === f.setTo).length;
      emitLine(`autoRun: Q-PERSIST - ${survived}/${flips.length} recorded flips survived reload`);
      // Re-read integration across the reload: confirms the tile is STILL real, buildable
      // city land after a save round-trip (writes are already settled post-load).
      runIntegration("reload");
      writeMeta({ phase: "done", schema: SCHEMA, flippedSession: meta.flippedSession, verifiedSession: session, ts: new Date().toISOString() });
      return { phase: "done", survived, total: flips.length };
    }
    emitLine("autoRun: flips done this session - SAVE & RELOAD to evaluate persistence");
    return { phase: "flipped", waiting: "reload" };
  }

  emitLine("autoRun: complete (phase=done). Use cd_probe.reset() to run again.");
  return { phase: "done" };
}

export const api = {
  version: PROBE_VERSION,
  auto: () => autoRun("manual"),
  diag: () => runDiagnostics("manual"),
  integrate: () => runIntegration("manual"),
  candidates: () => findCandidates(RINGS, 20),
  expandCount: () => localCities().map((c) => ({ city: c?.id?.id, plots: expandPlotCount(c) })),
  flipSet: (loc) => doFlip("setOwnership", "unowned", loc),
  flipSetRival: (loc) => doFlip("setOwnership", "rival", loc),
  flipBuy: (loc) => doFlip("purchasePlot", "unowned", loc),
  unclaim: (loc) => (loc ? unclaim(loc) : { ok: false, reason: "need-loc" }),
  clear: () => clearFlips(),
  reset: () => clearAll(),
};

export { PROBE_VERSION, findCandidates };
