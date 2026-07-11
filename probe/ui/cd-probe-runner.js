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
  plotIndexXY, canAssignWorker, expandPlotsInclude, tilePlacement, yieldsWithCity,
  constructiblesAt, assignWorker, createRuralDistrict, growthClaimPlot,
  cityWorkerCap, cityNumWorkers, districtAt, localSettlerId, settlerFoundPlots,
  ownerRingDepth, playerGold, isWaterAt, revealedStateAt, grantGold, netGoldYield,
  isCityCenterAt, cityAt, playerKind, reflectNames, enumMatch, cityTransferCanStart, cityTransferSend,
  districtTypeNameAt, diplomacyDealsPresence, cityCedeItem, sendCityCession, allPlayerIds, suzerainOf,
  isAtWarWith, diplomacyActionOps, declareWar, occupyOps,
  constructibleIndexByType, createCityMarker, cityHappiness,
} from "./cd-probe-api.js";
import {
  recordFlip, readFlips, clearFlips, readMeta, writeMeta, clearAll, readWork, recordWork,
  readVerb, recordVerb, updateVerb,
} from "./cd-probe-store.js";

const PROBE_VERSION = "0.9.27"; // cache-bust marker: log must read 0.9.27
const RINGS = 6;               // search out to 6 rings so we can test tiles BEYOND the normal 3-ring footprint
const SCHEMA = "v9-revolt19";    // re-arm token: if stored meta.schema differs, the probe clears + re-runs the new tests
// How long to wait for an async ownership/district write to settle before the FIRST verb
// classify. The 2026-07-09 run proved 2.5s is too short (every tile read no-change/FAILS then,
// yet was owned/integrated post-reload), so the seed read waits longer AND every turn-refresh
// re-classifies (runVerbRead), upgrading a verdict as a slow write finally lands.
const VERB_SETTLE_MS = 6000;

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
  // Q-WORK: after the flips, read (safely) whether the BEYOND-RING-3 owned tiles can be
  // worked/settled. WORK_MUTATE actually assigns a worker / places a rural district to
  // CONFIRM the read - destructive, so OFF by default (start a fresh game after enabling).
  WORK_READ: true,
  WORK_MUTATE: false,
  // Q-VERB (Phase 0 gate): claim a DISTINCT tile per candidate verb (Growth.claimPlot,
  // CREATE_ELEMENT DISTRICT_RURAL) and classify FREE-INTEGRATED / COSTS-GOLD / FAILS. This
  // MUTATES (claims tiles / creates rural districts) - on by default because deciding the
  // verb is the whole point of Phase 0; every target is empty/frontier land (reversible) or
  // a rival tile (throwaway save). Turn off to run the probe read-only.
  VERB_PROBE: true,
  // DIFFUSION DEMO: the earlier stages claim a few DISCONNECTED beyond-ring-3 tiles (great for
  // the verb test, invisible as "border growth"). This claims the CONTIGUOUS front - land tiles
  // adjacent to your existing territory - a few per turn, so the border visibly creeps outward
  // ring by ring, and eats into a rival where the front touches one (the visible rival-capture
  // test). Unowned land -> DISTRICT_RURAL (free, integrated); rival land -> purchasePlot (the
  // verb proven to capture rival tiles). MUTATES every turn; on by default so growth is visible.
  DIFFUSION_DEMO: true,
  DEMO_PER_TURN: 6,         // contiguous frontier tiles claimed per turn
  DEMO_CAPTURE_RIVAL: true, // also claim rival tiles on the front (visible capture; spends gold)
  // Verb for UNOWNED front tiles:
  //   "purchasePlot" = visible AND integrated (real City plot-acquisition path). Spends gold, but
  //                    DEMO_REFUND_GOLD grants the cost back so it nets ZERO - visible + integrated
  //                    + no treasury drain, the redesign-plan 2/3.6 ideal. DEFAULT.
  //   "setOwnership" = free + player-owned + repaints, but ORPHAN (no owning city, not workable).
  //   "stack"        = setOwnership+DISTRICT_RURAL - PROVEN not to integrate: both orders orphan
  //                    the tile (the two ownership models are mutually exclusive). Kept for ref.
  // Rival tiles always use purchasePlot (also refunded when DEMO_REFUND_GOLD).
  DEMO_UNOWNED_VERB: "purchasePlot",
  // Refund whatever purchasePlot spent this turn (via Players.grantYield GOLD), so the claim is
  // net-free. Proven write path (emigration mod). The player's gold dips for ~2.5s then restores.
  DEMO_REFUND_GOLD: true,
  DEMO_MIN_MS: 2500,        // min gap between demo advances (PlayerTurnActivated re-fires ~7x/s)
  // DESIGN RULE: cultural borders never annex tiles/cities held by a MINOR/independent (city-state).
  // City-states are won via suzerainty/diplomacy, not cultural conquest - so diffusion skips their
  // tiles and Phase-5 targets majors only. Off => diffusion may also contest city-states.
  EXCLUDE_CITY_STATES: true,
  // Q-COST (one-shot): the 2026-07-09 run showed purchasePlot is FREE even beyond ring 3 + on
  // rival tiles - so distance isn't the cost driver. Every free claim was CONTIGUOUS (adjacent to
  // owned). This measures purchasePlot's cost on a CONTIGUOUS vs a DISCONNECTED tile to decide the
  // rule: contiguity-required / contiguity-gated-pricing / unconditionally-free. Self-refunds.
  COST_PROBE: true,
  // Phase 5 (one-shot DISCOVERY): taking a rival/minor CITY-CENTER tile should ANNEX/ABSORB the
  // whole settlement, but there's no known runtime cede API. This reflects the API surface for a
  // city-transfer op + canStart-tests it READ-ONLY on a target city center. Non-destructive by
  // default; CITY_TRANSFER_MUTATE actually sends the op (destructive; throwaway save).
  CITY_TRANSFER: true,
  CITY_TRANSFER_MUTATE: false,
  // Phase 5 REAL path (base-game CityRevolt): place a hidden CityRevolt marker on a rival city
  // center -> the base-game revolt system transfers the settlement (to a candidate = us, since
  // diffusion surrounded it). REVOLT_MARKER_PLACE actually places the marker (destructive: it
  // triggers a real revolt on an enemy city - throwaway save). It has its OWN gate, separate from
  // CITY_TRANSFER_MUTATE (which drives the war/DiplomacyDeals experiments), so enabling the revolt
  // doesn't also declare war. On by default now that the data file is confirmed loaded.
  REVOLT_MARKER: true,
  REVOLT_MARKER_PLACE: true,
  // Which city to target for the Phase-5 test: "auto" (prefer a city-state = force-acceptable),
  // "minor" (only city-states), or "major" (test whether force-accept BINDS a major civ's city).
  CITY_TRANSFER_KIND: "auto",
  // The "annex at the cost of war" design: DECLARE WAR on the owner before the transfer, then
  // re-check cede-ability + take the city. War may be the ENABLER for majors (CEDE_OCCUPIED opens
  // at war). Only fires under CITY_TRANSFER_MUTATE (very destructive: real war on a throwaway save).
  CITY_TRANSFER_WAR_COST: false,
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
  let skippedWater = 0;
  let skippedHidden = 0;
  for (const city of cities) {
    const loc = cityLoc(city);
    if (!loc) continue;
    for (const p of plotsInRadius(loc, rings)) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Culture claims LAND, not ocean - and an ocean/fog flip produces no visible border
      // growth (the 2026-07-09 coastal-city run claimed only water/hidden tiles, so nothing
      // showed on the map). Skip water and fully-hidden tiles so every claim lands on visible
      // land the player can watch change owner (and so rival LAND tiles are the capture set).
      if (isWaterAt(p)) { skippedWater += 1; continue; }
      if (revealedStateAt(p) === 0) { skippedHidden += 1; continue; }
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
        // ringDepth = how deep the tile sits in the RIVAL's own footprint (1=core,
        // <=3=inside their worked ring, >3=their frontier). This is the frontier-vs-inside
        // distinction, independent of beyondCap (which is measured from MY city).
        const ringDepth = ownerRingDepth(p);
        rival.push({ ...p, ownerPlayer, ownerCity, beyondCap, ringDepth });
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
      rivalInsideRing3: rival.filter((r) => r.ringDepth >= 1 && r.ringDepth <= 3).length,
      rivalCoreRing1: rival.filter((r) => r.ringDepth === 1).length,
      skippedWater,
      skippedHidden,
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
    // (D) developed-state captured at flip time, so a later read can tell whether a rival's
    // improvement transferred to us (developed) or was stripped to bare land.
    consBefore: before.constructibleCount, consAfter: after.constructibleCount,
    distOwnerBefore: before.districtOwner, distOwnerAfter: after.districtOwner,
    ringDepth: (typeof target.ringDepth === "number") ? target.ringDepth : null, // depth in the RIVAL's footprint
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
  // Prefer a rival tile that already has a DISTRICT (developed) so the capture test (D) has
  // something to measure - does the improvement come across, or get stripped?
  const nextRival = () => {
    const i = rival.findIndex((r) => districtAt(r).present);
    return i >= 0 ? rival.splice(i, 1)[0] : (rival.shift() || null);
  };
  // The most INTERIOR rival tile (smallest ringDepth from THEIR city) - to test flipping a
  // tile INSIDE their 3-ring, not just their frontier.
  const nextDeepRival = () => {
    const inside = rival.filter((r) => typeof r.ringDepth === "number" && r.ringDepth >= 1 && r.ringDepth <= 3);
    inside.sort((a, b) => a.ringDepth - b.ringDepth);
    const pick = inside[0];
    if (pick) { const i = rival.indexOf(pick); if (i >= 0) rival.splice(i, 1); }
    return pick || null;
  };
  return {
    setNear: next(),                 // setOwnership, near - ISOLATED (never purchased)
    buyNear: next(),                 // purchasePlot, near
    setFar: nextFar(),               // setOwnership, beyond ring 3 - ISOLATED
    buyFar: nextFar(),               // purchasePlot, beyond ring 3
    setDeepRival: nextDeepRival(),   // INSIDE the rival's 3-ring (their worked footprint)
    setRival: nextRival(),           // contest case - prefer a developed rival tile (frontier)
    buyRival: nextRival(),
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
  run(AUTO.FLIP_RIVAL, "setOwnership/rivalDeep(inside ring3)", "setOwnership", "rivalDeep", t.setDeepRival);
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

// --- Q-VERB (Phase 0): FREE-INTEGRATED / COSTS-GOLD / FAILS per candidate verb ---
//
// The gate for the whole redesign (redesign-plan 2). setOwnership is retired (proven to
// orphan / fail on rival), purchasePlot works but spends gold. This test claims a DISTINCT
// tile per candidate free verb - Growth.claimPlot and CREATE_ELEMENT DISTRICT_RURAL - reads
// the player's gold SYNCHRONOUSLY around the call (a cost is deducted at call time), and,
// deferred (the ownership write settles ~2s later), reads whether the tile INTEGRATED
// (owner=me, real owning city, inCityPlots / rural district). Verdict per verb:
//   FREE-INTEGRATED - integrated with no gold spent  => adopt it (best case)
//   COSTS-GOLD      - integrated but gold was spent   => fall back to purchasePlot + cap
//   FAILS           - never integrated                => not a usable verb
// MUTATES (claims tiles); gated by AUTO.VERB_PROBE.

const VERB_TESTS = [
  { key: "growthClaimPlot", label: "Growth.claimPlot", call: (t, me) => growthClaimPlot(t.city, t.loc) },
  { key: "districtRural", label: "DISTRICT_RURAL", call: (t, me) => createRuralDistrict(t.loc, me, t.buildCID) },
];

// Deferred integration read for a verb-claimed tile (owner + real owning city + inCityPlots
// / rural district). INTEGRATED is the redesign-plan 1 success signal (owningCity set,
// inCityPlots true), with a rural district as the DISTRICT_RURAL verb's own success signal.
function verbIntegration(loc) {
  const me = localPlayerId();
  const idx = plotIndex(loc);
  const owner = owningPlayerIdAt(loc);
  const cid = owningCityCID(loc);
  const { city } = cityForPlot(loc);
  const inCityPlots = idx >= 0 && purchasedPlots(city).indexOf(idx) >= 0;
  const rural = constructiblesAt(loc).length > 0;
  const cityReal = !!cid;
  const integrated = cityReal && owner === me && (inCityPlots || rural);
  return { owner, ownerIsMe: owner === me, owningCityReal: cityReal, owningCityId: cidNum(cid), inCityPlots, rural, integrated };
}

function classifyVerb(integrated, goldSpent) {
  if (!integrated) return "FAILS";
  if (goldSpent == null) return "INTEGRATED-GOLD-UNKNOWN";
  return goldSpent > 0 ? "COSTS-GOLD" : "FREE-INTEGRATED";
}

// Pick a DISTINCT tile per (verb, kind) so no two verbs fight over one plot and the gold read
// isolates a single claim. near = ring 1-2 unowned, far = beyond ring 3 unowned, rival = a
// rival-owned tile (the capture case). CRUCIALLY, exclude any tile a flip already touched: in
// the 2026-07-09 run the flips reported no-change (so those tiles still read unowned) and the
// verb probe re-picked them, so DISTRICT_RURAL's tile ALSO carried a purchasePlot flip and the
// integration couldn't be attributed to one verb. Excluding flip tiles gives each verb a virgin
// plot.
function pickVerbTargets() {
  const c = findCandidates(RINGS, 80);
  const used = new Set(readFlips().map((f) => (f.loc ? `${f.loc.x},${f.loc.y}` : "")));
  const free = (arr) => (arr || []).filter((p) => !used.has(`${p.x},${p.y}`));
  const unowned = free(c.unowned);
  const rival = free(c.rival);
  const nextNear = () => { const i = unowned.findIndex((u) => !u.beyondCap); return i >= 0 ? unowned.splice(i, 1)[0] : null; };
  const nextFar = () => { const i = unowned.findIndex((u) => u.beyondCap); return i >= 0 ? unowned.splice(i, 1)[0] : null; };
  const nextRival = () => rival.shift() || null;
  const pickers = { near: nextNear, far: nextFar, rival: nextRival };
  const targets = [];
  for (const v of VERB_TESTS) {
    for (const kind of ["near", "far", "rival"]) {
      const loc = pickers[kind]();
      if (!loc) continue;
      const { city, buildCID } = cityForPlot(loc);
      targets.push({ verb: v.key, label: v.label, kind, loc, city, buildCID, call: v.call });
    }
  }
  return targets;
}

// FREE-INTEGRATED beats COSTS-GOLD beats FAILS; used to roll a verb's tiles up to one verdict.
const VERB_RANK = { "FREE-INTEGRATED": 3, "COSTS-GOLD": 2, "INTEGRATED-GOLD-UNKNOWN": 2, "FAILS": 1, PENDING: 0 };
const VERB_LABEL = { growthClaimPlot: "Growth.claimPlot", districtRural: "DISTRICT_RURAL" };

// Best verdict per verb PER KIND: { verb: { near, far, rival } }. Keeping the kind split is
// essential - the 2026-07-09 run showed Growth.claimPlot free-integrates a NEAR tile but FAILS
// beyond ring 3, so a "best across all tiles" rollup masks the fact that it can't claim the
// frontier the mod actually targets.
function verdictByVerbKind(markers) {
  const out = {};
  for (const m of markers) {
    if (!m.verdict) continue;
    const v = (out[m.verb] ||= {});
    const cur = v[m.kind];
    if (!cur || (VERB_RANK[m.verdict] || 0) > (VERB_RANK[cur] || 0)) v[m.kind] = m.verdict;
  }
  return out;
}

// The mod claims the frontier BEYOND ring 3, so the FAR verdict decides; fall back to near/rival
// only when no far tile has been tested yet (e.g. no beyond-ring-3 candidate on this map).
function frontierVerdict(vk) {
  if (!vk) return "PENDING";
  return vk.far || vk.near || vk.rival || "PENDING";
}

// Human summary that exposes the near/far/rival split so the frontier result is never masked.
function verbSummary(byKind) {
  return Object.keys(byKind).map((k) => {
    const vk = byKind[k];
    const parts = [`near:${vk.near || "-"}`, `far:${vk.far || "-"}`];
    if (vk.rival) parts.push(`rival:${vk.rival}`);
    return `${VERB_LABEL[k] || k}[${parts.join(" ")}]`;
  }).join(" | ");
}

// The redesign-plan §2 / §9.8 decision tree, driven by the FRONTIER (beyond-ring-3) verdict.
function verbDecision(byKind) {
  const claim = frontierVerdict(byKind.growthClaimPlot);
  const rural = frontierVerdict(byKind.districtRural);
  if (claim === "FREE-INTEGRATED") return "verb = Growth.claimPlot (FREE-INTEGRATED beyond ring 3)";
  if (rural === "FREE-INTEGRATED") return "verb = DISTRICT_RURAL (FREE-INTEGRATED beyond ring 3)";
  const costy = new Set(["COSTS-GOLD", "INTEGRATED-GOLD-UNKNOWN"]);
  if (costy.has(claim) || costy.has(rural)) return "no free verb beyond ring 3 => verb = purchasePlot + gold cap (maxGoldPerTurn)";
  return "no verb free-integrates beyond ring 3 yet => re-read on a map with beyond-ring-3 + rival tiles";
}

export function runVerbProbe(trigger) {
  if (!AUTO.VERB_PROBE || !guardSP()) return { skipped: true };
  const runId = newRunId();
  const me = localPlayerId();
  const session = sessionNonce();
  const targets = pickVerbTargets();
  emitLine(`RUN_START verb ${runId} trigger=${trigger} targets=${targets.length}`);
  if (!targets.length) {
    hudVerdict("VERB: play toward an AI border - no claimable candidate tiles yet", "verb");
    emitLine("Q-VERB: no candidate tiles to claim yet - will retry when the map has frontier/rival tiles.");
    emitLine(`RUN_END verb ${runId}`);
    return { pending: true };
  }
  // Fire each verb on its distinct tile, bracketing the call with a synchronous gold read (a
  // gold cost is applied at call time; ownership/integration settles async).
  const markers = [];
  for (const t of targets) {
    const goldBefore = playerGold(me);
    const call = t.call(t, me);
    const goldImmediate = playerGold(me);
    const marker = {
      runId, session, verb: t.verb, label: t.label, kind: t.kind, loc: t.loc,
      goldBefore, goldImmediate, call, verdict: "PENDING", ts: new Date().toISOString(),
    };
    markers.push(marker);
    recordVerb(marker);
    emitLine(`verb-call ${t.label}/${t.kind} loc=${t.loc.x},${t.loc.y} call=${call.reason} gold ${goldBefore}->${goldImmediate}`);
  }
  // Deferred: read integration + classify once the async write settles.
  const finish = () => {
    const rows = markers.map((m) => {
      const intg = verbIntegration(m.loc);
      const goldNow = playerGold(me);
      // Prefer the immediate delta (gold is deducted at call time); fall back to the deferred
      // read if the immediate read was unavailable. Same-turn, so income has not ticked.
      const goldSpent = (m.goldBefore != null && m.goldImmediate != null)
        ? Math.max(0, m.goldBefore - m.goldImmediate)
        : (m.goldBefore != null && goldNow != null ? Math.max(0, m.goldBefore - goldNow) : null);
      const verdict = classifyVerb(intg.integrated, goldSpent);
      updateVerb(m.runId, m.verb, m.kind, { verdict, goldSpent, integrated: intg.integrated });
      emitLine(`Q-VERB ${m.label}/${m.kind} loc=${m.loc.x},${m.loc.y} ownerIsMe=${intg.ownerIsMe} `
        + `owningCity=${intg.owningCityReal ? intg.owningCityId : "NONE"} inCityPlots=${intg.inCityPlots} `
        + `rural=${intg.rural} goldSpent=${goldSpent} => ${verdict}`);
      return { ...m, ...intg, goldSpent, verdict };
    });
    const byKind = verdictByVerbKind(rows);
    const decision = verbDecision(byKind);
    const summary = verbSummary(byKind);
    hudVerdict(`VERB: ${summary || "pending"} => ${decision}`, "verb");
    emitLine(`Q-VERB-ROLLUP: ${summary || "no-verdict"} => ${decision}. `
      + `Decision is driven by the FAR (beyond-ring-3) verdict - the frontier the mod claims. `
      + `A verb that is FREE-INTEGRATED near but FAILS far is range-limited and NOT usable for diffusion.`);
    emitSection(runId, "cd_verb", { probe_version: PROBE_VERSION, trigger, rows, byKind, decision });
    emitLine(`RUN_END verb ${runId} (seed read; turn-refresh will upgrade any late-settling verdict)`);
  };
  try { setTimeout(finish, VERB_SETTLE_MS); } catch (_) { finish(); }
  return { ok: true, targets: markers.length };
}

// Recompute gold spent for a marker from its (stable) claim-time gold reads.
function verbGoldSpent(m) {
  if (m.goldBefore != null && m.goldImmediate != null) return Math.max(0, m.goldBefore - m.goldImmediate);
  return (typeof m.goldSpent === "number") ? m.goldSpent : null;
}

// READ-ONLY refresh / Q-VERB-PERSIST: re-read every recorded verb marker's tile and RE-CLASSIFY
// with the current integration state. Async ownership/district writes can settle turns after the
// claim (the 2026-07-09 run's seed read said FAILS but the tile was integrated post-reload), so
// each turn we upgrade a marker's persisted verdict when it finally integrates - "did this verb
// EVER free-integrate the tile" is the capability signal, so we only ever raise a verdict, never
// lower it. On a reload this doubles as the persistence signal (did the claim survive?).
export function runVerbRead(trigger) {
  const markers = readVerb();
  if (!markers.length) return { pending: true };
  const runId = newRunId();
  emitLine(`RUN_START verb-read ${runId} trigger=${trigger} markers=${markers.length}`);
  const rows = markers.map((m) => {
    const intg = verbIntegration(m.loc);
    const goldSpent = verbGoldSpent(m);
    const now = classifyVerb(intg.integrated, goldSpent);
    // Monotonic upgrade: if the tile integrated later than the seed read, raise the verdict.
    const best = (VERB_RANK[now] || 0) > (VERB_RANK[m.verdict] || 0) ? now : m.verdict;
    if (best !== m.verdict) updateVerb(m.runId, m.verb, m.kind, { verdict: best, goldSpent, integrated: intg.integrated });
    return {
      verb: m.verb, label: m.label, kind: m.kind, loc: m.loc,
      verdictBest: best, verdictNow: now, ownerIsMe: intg.ownerIsMe, integratedNow: intg.integrated,
    };
  });
  for (const r of rows) {
    emitLine(`Q-VERB-PERSIST ${r.label}/${r.kind} loc=${r.loc.x},${r.loc.y} best=${r.verdictBest} now=${r.verdictNow} `
      + `ownerIsMe=${r.ownerIsMe} integratedNow=${r.integratedNow} => ${r.integratedNow ? "SURVIVED" : "lost"}`);
  }
  const byKind = verdictByVerbKind(readVerb()); // re-read so the rollup reflects any upgrades just written
  const summary = verbSummary(byKind);
  if (summary) {
    const decision = verbDecision(byKind);
    hudVerdict(`VERB: ${summary} => ${decision}`, "verb");
    emitLine(`Q-VERB-ROLLUP: ${summary} => ${decision} (refreshed ${trigger})`);
  }
  emitSection(runId, "cd_verb_read", { probe_version: PROBE_VERSION, trigger, rows });
  emitLine(`RUN_END verb-read ${runId}`);
  return rows;
}

// --- DIFFUSION DEMO: visible, contiguous border growth (and rival capture) -------------------
//
// The Q-* stages claim a handful of DISCONNECTED beyond-ring-3 tiles - correct for the verb
// decision, but invisible as "the border grew" (the 2026-07-09 run claimed a 4-tile speck at
// row 13, far from a city whose ring 1-3 was already fully owned). This stage instead claims the
// CONTIGUOUS FRONT: land tiles directly adjacent to the local player's existing territory. Doing
// a few per turn makes the colored border visibly creep outward ring by ring - and where that
// front touches a rival, it captures the rival's tile, which is the visible rival-capture test.

// Is a player id a MINOR/independent (city-state)? Memoized by id - a player's major/minor kind
// doesn't change, so caching is safe and keeps the per-tile frontier scan cheap.
const __cityStateMemo = new Map();
function ownerIsCityState(owner) {
  if (owner == null || owner < 0) return false;
  if (__cityStateMemo.has(owner)) return __cityStateMemo.get(owner);
  const v = playerKind(owner) === "minor";
  __cityStateMemo.set(owner, v);
  return v;
}

// LAND tiles adjacent to a tile the local player already owns, i.e. the true diffusion front
// (unowned OR rival). Skips water/hidden so every claim is visible land. Rival tiles are tagged.
// DESIGN RULE (EXCLUDE_CITY_STATES): never annex a minor/independent's tile - city-states are won
// via suzerainty, not cultural conquest.
function frontierRing(rings, limit) {
  const me = localPlayerId();
  const cities = localCities();
  const seen = new Set();
  const out = [];
  for (const city of cities) {
    const cloc = cityLoc(city);
    if (!cloc) continue;
    for (const p of plotsInRadius(cloc, rings)) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isWaterAt(p)) continue;
      if (revealedStateAt(p) === 0) continue;
      if (isCityCenterAt(p)) continue;                  // never tile-flip a settlement core (Phase 5 handles cities)
      const owner = owningPlayerIdAt(p);
      if (owner === me) continue;                       // already ours
      // Adjacent to a tile I own? (that is what makes the growth CONTIGUOUS / visible).
      let touchesMine = false;
      for (const n of plotsInRadius(p, 1)) {
        if (n.x === p.x && n.y === p.y) continue;
        if (owningPlayerIdAt(n) === me) { touchesMine = true; break; }
      }
      if (!touchesMine) continue;
      const isRival = owner != null && owner >= 0 && owner !== me;
      if (isRival && AUTO.EXCLUDE_CITY_STATES && ownerIsCityState(owner)) continue; // city-state tiles are immune
      out.push({ x: p.x, y: p.y, owner, rival: isRival });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Throttle: PlayerTurnActivated fired ~7x/second in the 2026-07-09 run, so an un-throttled demo
// blasted ~56 claims/second. Advance the front at most once per DEMO_MIN_MS so it creeps one
// ring per turn - watchable, and it can't hammer the engine.
function demoThrottled() {
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  const now = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
  if (g.__cdLastDemo && now - g.__cdLastDemo < (AUTO.DEMO_MIN_MS || 2500)) return true;
  g.__cdLastDemo = now;
  return false;
}

// purchasePlot whose gold cost is refunded in the SAME TICK, so the live gold counter never
// visibly moves. purchasePlot's cost is applied synchronously at the call (only tile ownership
// settles async), so reading the balance immediately after gives the exact cost, and a same-tick
// changeGoldBalance restores it before the frame renders => player-invisible. Returns the spent
// amount so the caller can also run a deferred backstop if some cost turned out to be async.
function purchaseRefunded(me, city, loc) {
  const before = playerGold(me);
  const r = flipViaPurchasePlot(city, loc);
  let cost = 0;
  if (AUTO.DEMO_REFUND_GOLD && before != null) {
    const after = playerGold(me);
    cost = (after != null) ? Math.max(0, before - after) : 0;
    if (cost > 0) grantGold(me, cost); // same-tick balance-only restore (no yield-stat, no visible dip)
  }
  return { r, cost };
}

export function runDiffusionDemo(trigger) {
  if (!AUTO.DIFFUSION_DEMO || !guardSP()) return { skipped: true };
  if (trigger !== "manual" && demoThrottled()) return { throttled: true };
  const me = localPlayerId();
  if (!localCities().length) return { skipped: "no-city" };
  const front = frontierRing(RINGS, AUTO.DEMO_PER_TURN);
  if (!front.length) {
    hudVerdict("DIFFUSION: no land frontier adjacent to your territory yet (boxed by your own tiles / water) - play toward open land or an AI", "demo");
    emitLine("DIFFUSION-DEMO: no contiguous land front adjacent to your territory this turn.");
    return { pending: true };
  }
  const runId = newRunId();
  emitLine(`RUN_START diffusion-demo ${runId} trigger=${trigger} front=${front.length} verb=${AUTO.DEMO_UNOWNED_VERB}`);
  // Snapshot the two values the demographics mod reads for its gold metrics - the Treasury BALANCE
  // and the net-gold-yield RATE - so we can REFUND purchasePlot's cost (net-zero balance) AND prove
  // the yield-rate metric never moved.
  const goldBefore = playerGold(me);
  const yieldBefore = netGoldYield(me);
  let claimed = 0;
  let rivalClaimed = 0;
  let skippedRival = 0;
  let spentAny = false;    // did any purchasePlot run this turn (worth a deferred backstop)?
  let syncRefunded = 0;    // total refunded in-tick (invisible); if this covers it, no dip at all
  const stackedLocs = []; // unowned tiles claimed via the "stack" verb - read back to see if integration held
  const captures = [];    // rival tiles captured this turn - read back TRANSFERRED/STRIPPED per improvement kind
  let stackIdx = 0;
  for (const t of front) {
    const { city, buildCID } = cityForPlot(t);
    let r;
    let verb;
    if (t.rival) {
      if (!AUTO.DEMO_CAPTURE_RIVAL) { skippedRival += 1; continue; }
      verb = "purchasePlot";                       // proven to capture rival tiles (spends gold; refunded same-tick)
      // Snapshot the rival tile's improvement BEFORE capture, so the deferred read can tell whether
      // it TRANSFERRED (came across developed) or was STRIPPED - and whether it was a RURAL improvement
      // (tile-bound, should transfer) or an URBAN building (city-bound, expected to strip). Points 1 & 2.
      const distName = districtTypeNameAt(t) || String(districtAt(t).type ?? "");
      const consBefore = constructiblesAt(t).length;
      const kind = /RURAL/.test(distName) ? "rural" : (/URBAN/.test(distName) ? "urban" : (consBefore > 0 ? "other" : "bare"));
      captures.push({ loc: { x: t.x, y: t.y }, consBefore, distTypeBefore: distName, kind });
      const pr = purchaseRefunded(me, city, t);
      r = pr.r; syncRefunded += pr.cost; spentAny = true;
    } else if (AUTO.DEMO_UNOWNED_VERB === "purchasePlot") {
      verb = "purchasePlot";                       // integrated, visible (spends gold; refunded same-tick)
      const pr = purchaseRefunded(me, city, t);
      r = pr.r; syncRefunded += pr.cost; spentAny = true;
    } else if (AUTO.DEMO_UNOWNED_VERB === "stack") {
      // The stack hypothesis: setOwnership repaints the border, DISTRICT_RURAL attaches an owning
      // city + rural district (free integration) - together => visible + integrated + free. Order
      // matters and forward failed (setOwnership claims the tile, so DISTRICT_RURAL then refuses),
      // so test BOTH orders on alternating tiles; the read-back reports integration per order.
      const reverse = (stackIdx % 2) === 1;
      stackIdx += 1;
      if (reverse) {
        // rural FIRST (claims + integrates the unowned tile), then setOwnership (repaint) - does
        // the owning-city attachment survive setOwnership, or does setOwnership re-orphan it?
        verb = "stack:rural->set";
        const rRural = createRuralDistrict(t, me, buildCID);
        const rSet = flipViaSetOwnership(me, t);
        r = { ok: rRural.ok || rSet.ok, reason: `rural:${rRural.reason} set:${rSet.reason}` };
      } else {
        verb = "stack:set->rural";
        const rSet = flipViaSetOwnership(me, t);
        const rRural = createRuralDistrict(t, me, buildCID);
        r = { ok: rSet.ok || rRural.ok, reason: `set:${rSet.reason} rural:${rRural.reason}` };
      }
      if (r.ok) stackedLocs.push({ x: t.x, y: t.y, order: reverse ? "rural->set" : "set->rural" });
    } else {
      verb = "setOwnership";                        // free + repaints, but orphan (no owning city)
      r = flipViaSetOwnership(me, t);
    }
    if (r.ok) { claimed += 1; if (t.rival) rivalClaimed += 1; }
    emitLine(`demo-claim ${t.x},${t.y} ${t.rival ? `RIVAL(owner=${t.owner})` : "unowned"} via ${verb} => ${r.reason}`);
  }
  hudVerdict(`DIFFUSION: +${claimed} contiguous frontier tile(s) this turn${rivalClaimed ? ` (${rivalClaimed} CAPTURED from a rival)` : ""}`
    + ` via ${AUTO.DEMO_UNOWNED_VERB}${rivalClaimed ? "/purchasePlot" : ""} - watch the border grow`, "demo");
  emitLine(`RUN_END diffusion-demo ${runId} claimed=${claimed} rivalCaptured=${rivalClaimed} skippedRival=${skippedRival}`);
  // Deferred CAPTURE read (points 1 & 2): for each captured rival tile, did its improvement come
  // across? RURAL improvements are tile-bound (expect TRANSFERRED); URBAN buildings are city-bound
  // (expect STRIPPED - a building can't survive its plot leaving the losing city).
  if (captures.length) {
    const readCap = () => {
      const by = { rural: { t: 0, s: 0 }, urban: { t: 0, s: 0 }, other: { t: 0, s: 0 } };
      for (const c of captures) {
        const ownerNow = owningPlayerIdAt(c.loc);
        const consNow = constructiblesAt(c.loc).length;
        let v;
        if (ownerNow !== me) v = "NOT-CAPTURED";
        else if (c.consBefore === 0) v = "BARE";
        else if (consNow > 0) v = "TRANSFERRED";
        else v = "STRIPPED";
        const g = by[c.kind === "bare" ? "other" : c.kind] || by.other;
        if (v === "TRANSFERRED") g.t += 1; else if (v === "STRIPPED") g.s += 1;
        emitLine(`Q-CAPTURE ${c.kind} loc=${c.loc.x},${c.loc.y} dist=${c.distTypeBefore} `
          + `cons ${c.consBefore}->${consNow} ownerNowMe=${ownerNow === me} => ${v}`);
      }
      hudVerdict(`CAPTURE: rural=${by.rural.t}T/${by.rural.s}S urban=${by.urban.t}T/${by.urban.s}S other=${by.other.t}T/${by.other.s}S `
        + `- improvements ${(by.rural.t + by.other.t) && !(by.rural.s + by.other.s) ? "TRANSFER" : "vary"}, urban buildings ${by.urban.s && !by.urban.t ? "STRIP (need city capture=Phase5)" : "vary"}`, "capture");
      emitLine(`Q-CAPTURE-ROLLUP rural=${by.rural.t}T/${by.rural.s}S urban=${by.urban.t}T/${by.urban.s}S other=${by.other.t}T/${by.other.s}S. `
        + `Tile-bound improvements transfer; city-bound urban buildings strip - getting the buildings needs whole-city capture (Phase 5).`);
    };
    try { setTimeout(readCap, 2500); } catch (_) { readCap(); }
  }
  // Deferred: did the stack keep INTEGRATION (owner=me + real owning city + rural), or did
  // setOwnership re-orphan the tile? Your eyes confirm the PAINT; this confirms the integration.
  if (stackedLocs.length) {
    const check = () => {
      // Tally integration per ORDER so we know which (if either) stack keeps the owning city.
      const by = { "set->rural": { ok: 0, n: 0 }, "rural->set": { ok: 0, n: 0 } };
      for (const loc of stackedLocs) {
        const intg = verbIntegration(loc);
        const g = by[loc.order] || (by[loc.order] = { ok: 0, n: 0 });
        g.n += 1; if (intg.integrated) g.ok += 1;
        emitLine(`DIFFUSION-STACK [${loc.order}] ${loc.x},${loc.y} ownerIsMe=${intg.ownerIsMe} `
          + `owningCity=${intg.owningCityReal ? intg.owningCityId : "NONE"} rural=${intg.rural} `
          + `=> ${intg.integrated ? "INTEGRATED" : "ORPHAN"}`);
      }
      const fmt = (k) => `${k}:${by[k].ok}/${by[k].n}`;
      const anyOk = by["set->rural"].ok > 0 || by["rural->set"].ok > 0;
      hudVerdict(`STACK integration => ${fmt("set->rural")} ${fmt("rural->set")}`
        + `${anyOk ? " - a stack order KEEPS integration; if you also SEE the border, that's the verb" : " - both orders ORPHAN (setOwnership & DISTRICT_RURAL can't coexist)"}`, "stack");
      emitLine(`DIFFUSION-STACK-ROLLUP: ${fmt("set->rural")} ${fmt("rural->set")}. `
        + `A non-zero order that ALSO paints => free+integrated+visible verb (adopt for Phase 1). `
        + `Both 0 => the two verbs' ownership models conflict; integration needs purchasePlot (gold) or a border-refresh call on DISTRICT_RURAL.`);
    };
    try { setTimeout(check, 2500); } catch (_) { check(); }
  }
  // Per-tile refund already restored the balance IN-TICK (invisible). The deferred pass is a
  // BACKSTOP: if any of purchasePlot's cost turned out to be async (landed after our same-tick
  // refund), reconcile it now, and re-read the two demographics metrics to PROVE neither moved.
  if (AUTO.DEMO_REFUND_GOLD && spentAny && goldBefore != null) {
    const check = () => {
      const goldNow = playerGold(me);
      const residual = (goldNow != null) ? Math.max(0, goldBefore - goldNow) : 0; // async leftover, if any
      let g = { reason: "none" };
      if (residual > 0) g = grantGold(me, residual); // rare async case; balance-only
      const goldAfter = playerGold(me);
      const yieldAfter = netGoldYield(me);
      const balanceOk = goldAfter != null && Math.abs(goldAfter - goldBefore) <= 1;
      const yieldOk = yieldBefore == null || yieldAfter == null || Math.abs((yieldAfter || 0) - (yieldBefore || 0)) <= 1;
      const invisible = residual === 0; // nothing leaked past the same-tick refund => never a visible dip
      hudVerdict(`GOLD: ${syncRefunded} refunded in-tick${residual ? ` (+${residual} async)` : ""} - `
        + `${invisible ? "PLAYER-INVISIBLE" : "brief dip"}; Treasury ${balanceOk ? "net-zero" : "OFF!"}, `
        + `Gold/Turn ${yieldOk ? "unchanged" : "MOVED!"}`, "gold");
      emitLine(`DIFFUSION-REFUND syncRefunded=${syncRefunded} asyncResidual=${residual} `
        + `balance ${goldBefore}->${goldNow}->${goldAfter} netGoldYield ${yieldBefore}->${yieldAfter} `
        + `via=${g.reason} => invisible=${invisible} balanceOk=${balanceOk} yieldOk=${yieldOk}`);
      emitLine(`DIFFUSION-METRIC-SAFE demographics gold metrics: Treasury=${balanceOk ? "clean" : "DISTURBED"} `
        + `GoldPerTurn=${yieldOk ? "clean" : "DISTURBED"}. Same-tick changeGoldBalance restore => the live gold `
        + `counter never moves (invisible=${invisible}) and the net-yield RATE is untouched.`);
    };
    try { setTimeout(check, 2500); } catch (_) { check(); }
  }
  return { claimed, rivalClaimed, stacked: stackedLocs.length };
}

// --- Q-COST: is purchasePlot free because of CONTIGUITY, or unconditionally? -----------------
//
// The 2026-07-09 run showed purchasePlot free even beyond ring 3 and on rival tiles - so distance
// isn't the cost driver. Every free claim was CONTIGUOUS (adjacent to owned). This one-shot test
// measures purchasePlot's gold cost on a CONTIGUOUS tile vs a DISCONNECTED tile (unowned, NOT
// touching our territory) and classifies the rule. It refunds its own spend (net-zero, metric-safe).

// An unowned, revealed LAND tile with NO neighbor owned by the local player - the inverse of
// frontierRing's contiguity test (a "jump" the border can't reach by creeping).
function disconnectedTile() {
  const me = localPlayerId();
  const seen = new Set();
  for (const city of localCities()) {
    const cloc = cityLoc(city);
    if (!cloc) continue;
    for (const p of plotsInRadius(cloc, RINGS)) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isWaterAt(p)) continue;
      if (revealedStateAt(p) === 0) continue;
      if (isCityCenterAt(p)) continue;
      const owner = owningPlayerIdAt(p);
      if (owner == null || owner >= 0) continue; // want strictly UNOWNED for a clean cost read
      let touchesMine = false;
      for (const n of plotsInRadius(p, 1)) {
        if (n.x === p.x && n.y === p.y) continue;
        if (owningPlayerIdAt(n) === me) { touchesMine = true; break; }
      }
      if (!touchesMine) return { x: p.x, y: p.y };
    }
  }
  return null;
}

export function runCostProbe(trigger) {
  if (!AUTO.COST_PROBE || !guardSP()) return { skipped: true };
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  if (g.__cdCostProbeDone) return { done: true };
  const me = localPlayerId();
  if (!localCities().length) return { pending: "no-city" };
  const contig = frontierRing(RINGS, 1)[0]; // a tile touching owned territory
  const discon = disconnectedTile();        // an unowned tile NOT touching owned territory
  if (!contig || !discon) return { pending: "need-both-candidates" };
  g.__cdCostProbeDone = true;
  const runId = newRunId();
  // Measure purchasePlot's synchronous cost on a tile, then refund it (net-zero probe).
  const measure = (label, loc) => {
    const before = playerGold(me);
    const { city } = cityForPlot(loc);
    const call = flipViaPurchasePlot(city, loc);
    const after = playerGold(me);
    const cost = (before != null && after != null) ? Math.max(0, before - after) : null;
    if (cost && cost > 0) grantGold(me, cost); // net-zero, balance-only (metric-safe)
    return { label, loc, cost, call };
  };
  emitLine(`RUN_START cost ${runId} trigger=${trigger} contig=${contig.x},${contig.y} discon=${discon.x},${discon.y}`);
  const c = measure("contiguous", contig);
  const d = measure("disconnected", discon);
  const finish = () => {
    const cClaimed = owningPlayerIdAt(contig) === me;
    const dClaimed = owningPlayerIdAt(discon) === me;
    if (!cClaimed && !dClaimed) {
      // Fired before the map/city could purchase (both claimed=false). Re-arm so it retries.
      g.__cdCostProbeDone = false;
      emitLine(`Q-COST inconclusive (neither claimed yet) - will retry next turn`);
      emitLine(`RUN_END cost ${runId}`);
      return;
    }
    let rule;
    if (!dClaimed && cClaimed) {
      rule = "CONTIGUITY-REQUIRED - purchasePlot refuses a disconnected tile; contiguous is free. "
        + "Diffusion is inherently contiguous, so the mod is free at all ranges (no gold, no refund).";
    } else if ((d.cost || 0) > 0 && (c.cost || 0) === 0) {
      rule = "CONTIGUITY-GATED PRICING - contiguous free, disconnected costs gold. "
        + "The contiguous diffusion front is free; only refund if a claim ever jumps.";
    } else if ((c.cost || 0) === 0 && (d.cost || 0) === 0 && dClaimed) {
      rule = "UNCONDITIONALLY FREE - purchasePlot never charges (contiguous OR disconnected). "
        + "The refund machinery is never needed; 'purchasePlot spends gold' was a wrong assumption.";
    } else {
      rule = `contiguous cost=${c.cost} claimed=${cClaimed} | disconnected cost=${d.cost} claimed=${dClaimed} (inconclusive)`;
    }
    hudVerdict(`COST: contiguous=${c.cost}g${cClaimed ? "" : "(no-claim)"} disconnected=${d.cost}g${dClaimed ? "" : "(no-claim)"} => ${rule.split(" - ")[0]}`, "cost");
    emitLine(`Q-COST contiguous loc=${contig.x},${contig.y} cost=${c.cost} claimed=${cClaimed} | `
      + `disconnected loc=${discon.x},${discon.y} cost=${d.cost} claimed=${dClaimed} => ${rule}`);
    emitSection(runId, "cd_cost", {
      probe_version: PROBE_VERSION, trigger,
      contiguous: { ...c, claimed: cClaimed }, disconnected: { ...d, claimed: dClaimed }, rule,
    });
    emitLine(`RUN_END cost ${runId}`);
  };
  try { setTimeout(finish, 2500); } catch (_) { finish(); }
  return { measured: true, contig, discon };
}

// --- Phase 5: cultural CITY CAPTURE - can a mod cede a whole settlement at runtime? ----------
//
// Taking a city-center TILE just moves the plot; the CITY stays with its owner (the broken half-
// state the user saw). Real annexation needs a city-transfer subsystem. No such runtime call is
// known (EFFECT_CITY_TRANSFER_OWNER is a DATA modifier; WorldBuilder = MapPlots only; Cities.* are
// getters). So this DISCOVERS: reflect the API surface for transfer-ish names, enumerate transfer
// operation-type enums, and canStart-test (READ-ONLY) each against a target rival/minor city center.

const XFER_RE = /transfer|annex|captur|cede|cession|acquire|raze|liberat|conquer|occup/i;

// Find a city-transfer target. A MINOR/city-state is the force-acceptable win, so it is ALWAYS
// preferred over a major - even an adjacent major (the 2026-07-09 run wrongly tested an adjacent
// major, which returns 0 offerable items at peace). Enumerate every player's cities directly
// (city.location IS the center), rank minor > any rival, adjacency only as a same-kind tiebreak.
function findCityCenterTarget() {
  const me = localPlayerId();
  const isNearMe = (loc) => {
    for (const n of plotsInRadius(loc, 1)) { if (owningPlayerIdAt(n) === me) return true; }
    return false;
  };
  // How many of a city center's neighbors WE own = our cultural pressure on it. The base loyalty
  // petition needs an adjacent claimant (us) to defect TO, so a MORE-surrounded city is a far
  // better revolt target than a random enemy capital.
  const surround = (loc) => {
    let n = 0;
    for (const p of plotsInRadius(loc, 1)) { if (!(p.x === loc.x && p.y === loc.y) && owningPlayerIdAt(p) === me) n += 1; }
    return n;
  };
  const cands = [];
  for (const pid of allPlayerIds()) {
    if (pid === me) continue;
    const kind = playerKind(pid);
    let cities = [];
    try { cities = Players?.get?.(pid)?.Cities?.getCities?.() || []; } catch (_) { cities = []; }
    for (const c of cities) {
      const cl = cityLoc(c);
      if (!cl) continue;
      cands.push({ loc: cl, owner: pid, kind, cityId: cidNum(c?.id), near: isNearMe(cl), surround: surround(cl) });
    }
  }
  if (!cands.length) return null;
  const pref = AUTO.CITY_TRANSFER_KIND || "auto";
  let pool = cands;
  // DESIGN RULE: with city-states excluded, Phase 5 only ever targets majors (unless the user
  // explicitly forces "minor" to test the city-state path).
  if (AUTO.EXCLUDE_CITY_STATES && pref !== "minor") {
    const majors = cands.filter((t) => t.kind !== "minor");
    if (majors.length) pool = majors;
  }
  if (pref === "minor") pool = pool.filter((t) => t.kind === "minor").length ? pool.filter((t) => t.kind === "minor") : pool;
  // Rank primarily by SURROUNDEDNESS (our cultural pressure / the defection recipient), then by
  // preferred kind. A city we hug is the one the loyalty petition can actually hand to us.
  const kindBonus = (t) => (pref === "major" ? (t.kind === "major" ? 1 : 0) : (t.kind === "minor" ? 1 : 0));
  const rank = (t) => (t.surround || 0) * 10 + kindBonus(t) + (t.near ? 1 : 0);
  pool.sort((a, b) => rank(b) - rank(a));
  return pool[0];
}

export function runCityTransfer(trigger) {
  if (!AUTO.CITY_TRANSFER || !guardSP()) return { skipped: true };
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  if (g.__cdXferDone) return { done: true };
  const me = localPlayerId();
  const runId = newRunId();

  // Reflect the API surface for transfer-ish names + enumerate transfer operation-type enums. This
  // is safe (name enumeration only) and answers "does a runtime city-transfer call even exist?".
  const surface = {
    Cities: reflectNames(typeof Cities !== "undefined" ? Cities : null, XFER_RE),
    WorldBuilder: reflectNames(typeof WorldBuilder !== "undefined" ? WorldBuilder : null, XFER_RE),
    playerOps: enumMatch("PlayerOperationTypes", XFER_RE),
    cityOps: enumMatch("CityOperationTypes", XFER_RE),
    cityCommands: enumMatch("CityCommandTypes", XFER_RE),
  };
  const target = findCityCenterTarget();
  const cityMethods = target ? reflectNames(cityAt(target.loc), XFER_RE) : [];
  emitLine(`RUN_START cityTransfer ${runId} trigger=${trigger} target=${target ? `${target.loc.x},${target.loc.y}(owner=${target.owner},${target.kind})` : "none"}`);
  emitLine(`Q-XFER-SURFACE Cities[${surface.Cities.join(",")}] WorldBuilder[${surface.WorldBuilder.join(",")}] `
    + `city[${cityMethods.join(",")}] playerOps[${surface.playerOps.map((o) => o.key).join(",")}] `
    + `cityOps[${surface.cityOps.map((o) => o.key).join(",")}] cityCommands[${surface.cityCommands.map((o) => o.key).join(",")}]`);

  // The DiplomacyDeals API surface is target-independent - report it even before we have a target.
  const dd = diplomacyDealsPresence();
  emitLine(`Q-XFER-DEALS present=${dd.present} methods=[${dd.methods.join(",")}] `
    + `cityTransferTypes=[${dd.cityTransferTypes.join(",")}] proposalActions=[${dd.proposalActions.join(",")}]`);

  if (!target) {
    hudVerdict(`CITY-CAPTURE (Phase 5): DiplomacyDeals ${dd.present ? "PRESENT" : "absent"}; waiting for a rival/city-state city in range`, "xfer");
    emitLine(`Q-XFER: no rival/minor city found yet (DiplomacyDeals present=${dd.present}). Play toward an AI/city-state settlement.`);
    emitLine(`RUN_END cityTransfer ${runId}`);
    return { pending: "no-target", dealsPresent: dd.present };
  }
  g.__cdXferDone = true;
  const targetCityIdNum = (typeof target.cityId === "number" && target.cityId >= 0) ? target.cityId : cidNum(cityAt(target.loc)?.id);
  // Suzerainty: Fealty's default only lets you transfer a city-state's city when you're its
  // SUZERAIN, so this says whether the target is takeable per the native relationship rules.
  const suz = target.kind === "minor" ? suzerainOf(target.owner) : null;
  const iAmSuzerain = suz === me;
  let cede = { ok: false, item: null, count: 0, subTypes: [], dealId: null, synthetic: false };
  if (dd.present) {
    cede = cityCedeItem(me, target.owner, targetCityIdNum);
    emitLine(`Q-XFER-CEDE target=${target.loc.x},${target.loc.y} owner=${target.owner}(${target.kind}) cityId=${targetCityIdNum} `
      + `suzerain=${suz}${target.kind === "minor" ? `(mine=${iAmSuzerain})` : ""} `
      + `enumeratedCityItems=${cede.count} subTypes=[${(cede.subTypes || []).join(",")}] item=${cede.item ? (cede.synthetic ? "SYNTHETIC" : "enumerated") : "none"}`);
  }

  // --- SECONDARY context: reflect op-type enums + canStart (kept for completeness) --------------
  const cid = cityAt(target.loc)?.id || null;
  const argShapes = [{ City: cid }, { CityID: cid }, { X: target.loc.x, Y: target.loc.y }, { Location: plotIndex(target.loc) }];
  const attempts = [];
  const tryOps = (scope, ops) => {
    for (const op of ops) {
      for (const args of argShapes) {
        const res = cityTransferCanStart(scope, me, op.value, args);
        attempts.push({ scope, op: op.key, args: Object.keys(args).join("+"), canStart: !!res.success });
        if (res.success) return { scope, op, args };
      }
    }
    return null;
  };
  const opHit = tryOps("player", surface.playerOps) || tryOps("city", surface.cityOps) || tryOps("cityCommand", surface.cityCommands);

  // War-declaration op surface + city-conquest op surface (for the "annex at cost of war" design).
  const warOps = diplomacyActionOps();
  const occ = occupyOps();
  emitLine(`Q-XFER-WAR-OPS atWarNow=${isAtWarWith(me, target.owner)} declareWarOps=[${warOps.map((o) => o.key).join(",")}]`);
  emitLine(`Q-XFER-OCCUPY-OPS player=[${occ.player.map((o) => o.key).join(",")}] city=[${occ.city.map((o) => o.key).join(",")}] `
    + `cityCommand=[${occ.cityCommand.map((o) => o.key).join(",")}] unit=[${occ.unit.map((o) => o.key).join(",")}] unitCommand=[${occ.unitCommand.map((o) => o.key).join(",")}]`);

  // --- DESTRUCTIVE attempt (opt-in): "game it" - add the city item (enumerated OR synthetic) and
  // force-accept via sendWorkingDeal(ACCEPTED). Fealty only force-accepts minor/IP and merely
  // PROPOSES to majors - but that is its design choice, not a proven engine limit. So we attempt
  // for ALL kinds under MUTATE, to learn whether ACCEPTED also FORCES a major's city (the open door).
  const canForce = dd.present && cede.item;
  if (AUTO.CITY_TRANSFER_MUTATE && canForce) {
    const ownerBefore = owningPlayerIdAt(target.loc);
    // "Annex at the cost of war": optionally DECLARE WAR first (may be the ENABLER for a major -
    // CEDE_OCCUPIED opens at war), then re-check cede-ability, then take the city.
    let warRes = null;
    let atWar = isAtWarWith(me, target.owner);
    let useCede = cede;
    if (AUTO.CITY_TRANSFER_WAR_COST && !atWar) {
      warRes = declareWar(me, target.owner);
      atWar = isAtWarWith(me, target.owner);
      // At war the correct transfer type is CEDE_OCCUPIED - re-check preferring it (and build a
      // synthetic CEDE_OCCUPIED item if the engine still surfaces nothing).
      const reCede = cityCedeItem(me, target.owner, targetCityIdNum, { cede: true });
      if (reCede.item) useCede = reCede;
      emitLine(`Q-XFER-WAR declared=${warRes.ok}(${warRes.reason}) atWarNow=${atWar} wantSubType=${reCede.wantSubType} `
        + `postWarCityItems=${reCede.count} subTypes=[${(reCede.subTypes || []).join(",")}] item=${reCede.item ? (reCede.synthetic ? "SYNTHETIC-CEDE_OCCUPIED" : "enumerated") : "none"}`);
    }
    const send = sendCityCession(useCede.dealId, useCede.item);
    const finish = () => {
      const ownerNow = owningPlayerIdAt(target.loc);
      const transferred = ownerNow === me && ownerNow !== ownerBefore;
      const atWarAfter = isAtWarWith(me, target.owner);
      emitLine(`Q-XFER-WAR-RESULT warCost=${AUTO.CITY_TRANSFER_WAR_COST} declared=${warRes ? warRes.ok : "n/a"} `
        + `atWar=${atWarAfter} transferred=${transferred} kind=${target.kind}`);
      const warTag = AUTO.CITY_TRANSFER_WAR_COST ? " [via WAR]" : "";
      const verdict = transferred
        ? (target.kind === "minor" ? `ABSORBED (minor city-state)${warTag}` : `ANNEXED (MAJOR${warTag ? " - war enabled it!" : " - force-accept BINDS majors!"})`)
        : `no-transfer (${target.kind === "major" ? (AUTO.CITY_TRANSFER_WAR_COST ? "even at war, un-occupied major city won't cede - needs actual occupation" : "major NOT forceable at peace - try CITY_TRANSFER_WAR_COST=true") : "engine rejected the forced deal"})`;
      hudVerdict(`CITY-CAPTURE (Phase 5): ${useCede.synthetic ? "synthetic-item " : ""}force-accept ${target.kind}${warTag} => ${verdict}`, "xfer");
      emitLine(`Q-XFER-RESULT via=DiplomacyDeals${useCede.synthetic ? "(synthetic-item)" : ""} sent=${send.ok}(${send.reason}) `
        + `kind=${target.kind} suzerainMine=${iAmSuzerain} owner ${ownerBefore}->${ownerNow} => ${verdict}`);
      emitLine(`RUN_END cityTransfer ${runId}`);
    };
    try { setTimeout(finish, 2500); } catch (_) { finish(); }
    return { attempted: "diplomacyDeals", forced: true, synthetic: cede.synthetic, kind: target.kind };
  }

  // --- READ-ONLY verdict ------------------------------------------------------------------------
  const enumerated = cede.item && !cede.synthetic;
  let rule;
  if (enumerated) {
    rule = `CEDE-ABLE via Game.DiplomacyDeals (engine offered the city). `
      + `${target.kind === "minor" ? `MINOR${iAmSuzerain ? " (you are SUZERAIN)" : ""} => FORCE-ACCEPT: set AUTO.CITY_TRANSFER_MUTATE=true` : "MAJOR => needs the AI to agree"}.`;
  } else if (dd.present && target.kind === "minor") {
    rule = `city-state city NOT engine-offered (enumerated=0). suzerainMine=${iAmSuzerain}. `
      + `${iAmSuzerain ? "you ARE suzerain, so a SYNTHETIC item + force-accept is worth trying (MUTATE)" : "you are NOT suzerain - per Fealty rules you must become suzerain first (cultural pressure -> suzerainty -> absorb)"}. `
      + `A synthetic city item was constructed for the MUTATE attempt.`;
  } else if (dd.present) {
    rule = `DiplomacyDeals present, ${target.kind} city not engine-offered at peace (subTypes=[${(cede.subTypes || []).join(",")}]) `
      + `- majors need ALLIANCE or WAR+occupation (CEDE_OCCUPIED). A synthetic item was built for a MUTATE attempt.`;
  } else if (opHit) {
    rule = `no DiplomacyDeals, but op ${opHit.scope}/${opHit.op.key} canStart on the city.`;
  } else {
    rule = "no Game.DiplomacyDeals and no invokable transfer op - Phase 5 would need a DATA modifier.";
  }
  const hud = enumerated ? (target.kind === "minor" ? "CEDE-ABLE (minor, FORCE-ACCEPT)" : "CEDE-ABLE (major needs agree)")
    : (dd.present ? (target.kind === "minor" ? `city-state not offered (suzerain=${iAmSuzerain}) - MUTATE tries synthetic` : "not offered at peace - MUTATE tries synthetic") : "no runtime API");
  hudVerdict(`CITY-CAPTURE (Phase 5): ${hud}`, "xfer");
  emitLine(`Q-XFER-ROLLUP target=${target.loc.x},${target.loc.y} kind=${target.kind} suzerainMine=${iAmSuzerain} => ${rule}`);
  emitSection(runId, "cd_xfer", { probe_version: PROBE_VERSION, trigger, target, suzerain: suz, iAmSuzerain, diplomacyDeals: dd, cede: { count: cede.count, subTypes: cede.subTypes, matched: !!cede.item, synthetic: cede.synthetic }, surface, cityMethods, opHit: opHit ? { scope: opHit.scope, op: opHit.op.key } : null, rule });
  emitLine(`RUN_END cityTransfer ${runId}`);
  return { discovered: true, cedeable: enumerated, kind: target.kind, suzerain: iAmSuzerain, synthetic: cede.synthetic };
}

// --- Phase 5 REAL path #2: REVOLT MARKER (base-game CityRevolt) ------------------------------
// Place a hidden CityRevolt marker constructible on a rival city center; the vanilla revolt system
// then transfers the settlement. This is the cleanest cultural city-capture: no war, works on
// majors, and the recipient is an adjacency/culture candidate - us, since diffusion surrounded it.

const REVOLT_MARKER_TYPE = "BUILDING_CD_REVOLT_MARKER";

export function runRevoltMarker(trigger) {
  if (!AUTO.REVOLT_MARKER || !guardSP()) return { skipped: true };
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  if (g.__cdRevoltDone) return { done: true };
  const me = localPlayerId();
  const runId = newRunId();
  const markerIdx = constructibleIndexByType(REVOLT_MARKER_TYPE);
  // DECISIVE CHECK: do the base-game LOYALTY petition stories exist, and did our AllowDuplicates
  // un-gate take? None found -> the revolt path is impossible here. Found but FirstOnly=true -> our
  // un-gate didn't apply, and that's the fix.
  if (!g.__cdStoriesDumped) {
    g.__cdStoriesDumped = true;
    const rows = [];
    try {
      const ns = (typeof GameInfo !== "undefined") ? GameInfo.NarrativeStories : null;
      if (ns) {
        for (const row of ns) {
          const t = row && (row.NarrativeStoryType || row.Type);
          if (t && /LOYALTY|REVOLT|REBEL|SECED|DEFECT/i.test(t)) rows.push(`${t}(FirstOnly=${row.FirstOnly},AllowDup=${row.AllowDuplicates})`);
        }
      }
    } catch (_) { /* ignore */ }
    emitLine(`Q-REVOLT-STORIES ${rows.length ? rows.join(" ") : "NONE found in GameInfo.NarrativeStories matching LOYALTY/REVOLT/REBEL - the base petition may not exist here."}`);
    // Dump full columns (read keys directly - GameInfo rows do NOT JSON.stringify) of every
    // GameInfo table row referencing LOYALTY001, to reveal the trigger/requirement that fires it.
    try {
      const gi = (typeof GameInfo !== "undefined") ? GameInfo : null;
      const rowKV = (row) => {
        const kv = [];
        for (const k in row) { try { const v = row[k]; if (v != null && typeof v !== "object" && typeof v !== "function") kv.push(`${k}=${v}`); } catch (_) { /* skip */ } }
        return kv;
      };
      const rowHasLoyalty = (row) => { for (const k in row) { try { const v = row[k]; if (typeof v === "string" && v.indexOf("LOYALTY001") >= 0) return true; } catch (_) { /* skip */ } } return false; };
      if (gi) {
        let dumped = 0;
        for (const tbl of Object.keys(gi)) {
          if (dumped >= 16) break;
          let table;
          try { table = gi[tbl]; } catch (_) { continue; }
          if (!table || typeof table[Symbol.iterator] !== "function") continue;
          try {
            for (const row of table) {
              if (rowHasLoyalty(row)) { emitLine(`Q-REVOLT-DEF ${tbl}: ${rowKV(row).join(" ").slice(0, 320)}`); dumped += 1; break; }
            }
          } catch (_) { /* skip */ }
        }
        if (!dumped) emitLine("Q-REVOLT-DEF: no GameInfo table has a string column containing LOYALTY001.");
      }
    } catch (_) { /* ignore */ }
  }
  const target = findCityCenterTarget();
  emitLine(`RUN_START revoltMarker ${runId} trigger=${trigger} markerType=${REVOLT_MARKER_TYPE} markerIndex=${markerIdx} `
    + `target=${target ? `${target.loc.x},${target.loc.y}(owner=${target.owner},${target.kind})` : "none"}`);

  if (markerIdx == null) {
    hudVerdict("REVOLT: marker constructible NOT in DB - the data file didn't load", "revolt");
    emitLine("Q-REVOLT: BUILDING_CD_REVOLT_MARKER absent from GameInfo.Constructibles - data ActionGroup failed to load.");
    emitLine(`RUN_END revoltMarker ${runId}`);
    return { noData: true };
  }
  if (!target) {
    hudVerdict("REVOLT: marker ready in DB; waiting for a rival/city-state city in range", "revolt");
    emitLine("Q-REVOLT: marker in DB but no rival/minor city target yet.");
    emitLine(`RUN_END revoltMarker ${runId}`);
    return { pending: "no-target", markerReady: true };
  }
  if (!AUTO.REVOLT_MARKER_PLACE) {
    hudVerdict(`REVOLT: READY - marker in DB + ${target.kind} target ${target.loc.x},${target.loc.y}. Set REVOLT_MARKER_PLACE=true to place it`, "revolt");
    emitLine(`Q-REVOLT-READY markerIndex=${markerIdx} target=${target.loc.x},${target.loc.y} kind=${target.kind} owner=${target.owner} `
      + "- set AUTO.REVOLT_MARKER_PLACE=true to CREATE_ELEMENT the revolt marker (destructive; throwaway save).");
    emitLine(`RUN_END revoltMarker ${runId}`);
    return { ready: true };
  }

  // DESTRUCTIVE: place the marker on the rival city center.
  g.__cdRevoltDone = true;
  const city = cityAt(target.loc);
  const ownerBefore = owningPlayerIdAt(target.loc);
  // FORCE-SURROUND: claim the city's neighbor tiles so WE are the adjacent claimant the loyalty
  // petition defects to. The demo may not have crept around this city, so do it directly here.
  let mineAdj = 0;
  let totalAdj = 0;
  let claimed = 0;
  for (const n of plotsInRadius(target.loc, 1)) {
    if (n.x === target.loc.x && n.y === target.loc.y) continue;
    totalAdj += 1;
    if (owningPlayerIdAt(n) === me) { mineAdj += 1; continue; }
    if (isWaterAt(n) || isCityCenterAt(n)) continue;
    const nc = cityForPlot(n).city;
    const r = flipViaPurchasePlot(nc, n);
    if (r.ok) { claimed += 1; mineAdj += 1; }
  }
  emitLine(`Q-REVOLT-SURROUND claimed ${claimed} neighbor tile(s) around ${target.loc.x},${target.loc.y} => now ${mineAdj}/${totalAdj} ours`);
  const hBefore = cityHappiness(city);
  // REQUESTER = the LOCAL player. Proven by evidence: placing as the city's owner (an AI we don't
  // control) silently no-ops - a -9999 happiness drain did NOT apply (net stayed positive), so the
  // constructible/modifier never attached. Placing as `me` DID attach the modifier (net crashed to
  // -916 in an earlier build). The Owner ARG stays the settlement owner (base-game revolt context).
  const placeRequester = me;
  const place = createCityMarker(me, city, markerIdx);
  emitLine(`Q-REVOLT-PLACE marker on ${target.loc.x},${target.loc.y} owner=${target.owner}(${target.kind}) requester=${placeRequester} `
    + `surroundContext=${mineAdj}/${totalAdj} happinessBefore=${hBefore ? `val=${hBefore.value},unhappy=${hBefore.unhappiness},unrest=${hBefore.hasUnrest},turns=${hBefore.turnsOfUnrest},net=${hBefore.netPerTurn}` : "n/a"} `
    + `=> sent=${place.ok}(${place.reason}) canStart=${place.canStart}`);
  // Record a watch. Store the target's exact city id + starting owner so the watch can match a
  // CityTransfered event to THIS city (id alone is ambiguous - it's per-player-indexed). Reset the
  // transfer log so only transfers AFTER placement count against us.
  g.__cdTransfers = [];
  g.__cdRevoltWatch = { loc: target.loc, ownerBefore, kind: target.kind, cityIdNum: target.cityId, placedTrigger: trigger };
  hudVerdict(`REVOLT: marker placed on ${target.kind} city ${target.loc.x},${target.loc.y} (id ${target.cityId}) - watching (may take turns)`, "revolt");
  emitLine(`RUN_END revoltMarker ${runId}`);
  return { placed: place.ok, loc: target.loc };
}

// READ-ONLY per-turn watch: after a marker is placed, re-read the city each turn - owner, its
// HAPPINESS/unrest (is the marker applying CityRevolt pressure, or inert?), and surroundedness
// (recipient CONTEXT only, NOT a trigger). The CityTransfered event (bootstrap) is independent proof.
export function runRevoltWatch(trigger) {
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  const w = g.__cdRevoltWatch;
  if (!w) return { none: true };
  const me = localPlayerId();
  // Authoritative owner reads: the CITY object's owner (not just the laggy plot getOwner), plus a
  // CityTransfered event matched to OUR exact city (fromPlayer == starting owner AND matching id).
  const plotOwner = owningPlayerIdAt(w.loc);
  const cityObj = cityAt(w.loc);
  // One-time dump of the REAL Happiness surface, so if the city still won't revolt we can see the
  // actual unrest/value fields + threshold instead of guessing which lever drives it.
  if (!g.__cdHappyDumped && cityObj) {
    g.__cdHappyDumped = true;
    const hn = reflectNames(cityObj.Happiness, /./);
    const cn = reflectNames(cityObj, /unrest|revolt|happ|unhapp|conquer|independ|loyal|rebel|value|disorder/i);
    emitLine(`Q-REVOLT-HAPPY-SURFACE Happiness=[${hn.join(",")}] city=[${cn.join(",")}]`);
    // Confirm our StandardCityRevolt Duration=0 override actually landed. Per the nasuellia dossier,
    // the vanilla revolt runs over SEVERAL turns unless Duration is forced to 0. If this reads a
    // non-zero Duration, the override never applied and THAT is why the city never flips instantly.
    try {
      const gi = (typeof GameInfo !== "undefined") ? GameInfo : null;
      const tbl = gi && gi.UnhappinessEffects;
      let found = "table-missing";
      if (tbl && typeof tbl[Symbol.iterator] === "function") {
        found = "StandardCityRevolt-not-found";
        for (const row of tbl) {
          const id = row && (row.ID || row.Id || row.Type);
          if (id === "StandardCityRevolt") {
            found = `Duration=${row.Duration} ScaleBySpeed=${row.ScaleBySpeed}`;
            break;
          }
        }
      }
      emitLine(`Q-REVOLT-DURATION StandardCityRevolt => ${found} (expect Duration=0 if our override applied)`);
    } catch (e) { emitLine(`Q-REVOLT-DURATION read failed: ${String(e)}`); }
  }
  const cityOwner = (cityObj && typeof cityObj.owner === "number") ? cityObj.owner : null;
  const transfers = Array.isArray(g.__cdTransfers) ? g.__cdTransfers : [];
  const match = transfers.find((t) => t && t.fromPlayer === w.ownerBefore
    && (w.cityIdNum == null || (t.cityID && (t.cityID.id === w.cityIdNum))));
  const eventOwner = match ? (match.cityID && typeof match.cityID.owner === "number" ? match.cityID.owner : null) : null;
  // Prefer the strongest signal: a matched transfer event > city-object owner > plot owner.
  const ownerNow = (eventOwner != null) ? eventOwner : (cityOwner != null ? cityOwner : plotOwner);
  const changed = ownerNow !== w.ownerBefore;
  const toMe = ownerNow === me;
  const recipientKind = playerKind(ownerNow);
  const h = cityHappiness(cityObj);
  let mineAdj = 0;
  let totalAdj = 0;
  for (const n of plotsInRadius(w.loc, 1)) {
    if (n.x === w.loc.x && n.y === w.loc.y) continue;
    totalAdj += 1; if (owningPlayerIdAt(n) === me) mineAdj += 1;
  }
  const gameTurn = (typeof Game !== "undefined" && Game.turn != null) ? Game.turn : "?";
  emitLine(`Q-REVOLT-WATCH turn=${gameTurn} ${w.loc.x},${w.loc.y} start=${w.ownerBefore} plotOwner=${plotOwner} cityOwner=${cityOwner} `
    + `matchedTransfer=${match ? `YES(->${eventOwner})` : "no"} => ownerNow=${ownerNow} changed=${changed} toMe=${toMe} recipientKind=${recipientKind} `
    + `happiness=${h ? `val=${h.value},unhappy=${h.unhappiness},unrest=${h.hasUnrest},turns=${h.turnsOfUnrest},net=${h.netPerTurn}` : "n/a"} surroundContext=${mineAdj}/${totalAdj} (${trigger})`);
  if (changed) {
    hudVerdict(`REVOLT: city ${w.loc.x},${w.loc.y} FLIPPED ${w.ownerBefore}->${ownerNow} `
      + `${toMe ? "=> CAME TO US! cultural capture WORKS" : `=> went to ${ownerNow}(${recipientKind})${recipientKind === "minor" ? " - free city; absorb next" : ""}`}`, "revolt");
    emitLine(`Q-REVOLT-RESULT city ${w.loc.x},${w.loc.y} id=${w.cityIdNum} => owner=${ownerNow}(${recipientKind}) toMe=${toMe} via=${match ? "CityTransfered-event" : (cityOwner != null ? "city-object" : "plot")}. `
      + `${toMe ? "CULTURAL CITY CAPTURE CONFIRMED." : recipientKind === "minor" ? "revolted to a FREE CITY - next: absorb it (cultural pressure / force-accept)." : "revolted to another player - tune recipient."}`);
    g.__cdRevoltWatch = null; // resolved
  }
  return { changed, toMe, ownerNow };
}

// --- Q-WORK: can a BEYOND-RING-3 owned tile be worked / settled? --------------
//
// The (1a)/(1c) make-or-break. For each recorded flip we read (SAFELY - all canStart /
// GetTilePlacementInfo / getYieldsWithCity are non-mutating) whether the engine would let
// the owning city WORK or EXPAND into the tile. WORK_MUTATE additionally performs the
// worker/rural-district placement to confirm the read (destructive; throwaway save).

// beyondCap is recorded on flip.loc (record.loc = the candidate), with the "far*" kind as
// a fallback for older/explicit records.
function isBeyond3(flip) {
  if (flip.loc && typeof flip.loc.beyondCap === "boolean") return flip.loc.beyondCap;
  return typeof flip.kind === "string" && flip.kind.indexOf("far") === 0;
}

function workSnapshot(flip) {
  const loc = flip.loc;
  const me = localPlayerId();
  const idx = plotIndexXY(loc);
  const { city, buildCID, owns } = cityForPlot(loc);
  const owner = owningPlayerIdAt(loc);
  const beyondCap = isBeyond3(flip);

  const worker = canAssignWorker(me, idx);          // read-only: would ASSIGN_WORKER succeed?
  const expand = expandPlotsInclude(buildCID, idx); // read-only: in the city's EXPAND set?
  const place = tilePlacement(city, idx);           // read-only: IsBlocked / worker counts
  const yld = yieldsWithCity(loc, buildCID);        // read-only: yields as worked by this city
  const cons = constructiblesAt(loc);               // rural district present?

  // A far tile is WORKABLE only on an AUTHORITATIVE engine signal: the engine will accept
  // a worker there (canStart ASSIGN_WORKER), or it already reads as an unblocked worker
  // tile in THIS city's placement set. NOTE: getYieldsWithCity is a hypothetical
  // "if-worked" yield that is >0 for almost any land tile, so it is informational only -
  // never a workability signal (it would produce false positives).
  const workable = !!worker.success || (place && place.isBlocked === false);

  return {
    verb: flip.verb, kind: flip.kind, loc, plotIndex: idx, beyondCap,
    ownerIsMe: owner === me, ownedByCity: owns,
    canAssignWorker: !!worker.success, inExpandSet: !!expand.includes,
    isBlocked: place ? place.isBlocked : null, yieldTotal: yld ? yld.total : null,
    ruralDistrictCount: cons.length,
    workerCap: cityWorkerCap(city), numWorkers: cityNumWorkers(city), // (C) cap context
    verdict: workable ? "WORKABLE" : "BLOCKED",
  };
}

// DESTRUCTIVE (opt-in, C+E): actually work each far owned tile (assign worker + rural
// district + Growth.claimPlot), recording before/after cap+workers (C) and a persistence
// marker (E) so a later session can prove the WORKED state - not just ownership - survived.
function runWorkMutate(trigger) {
  if (!AUTO.WORK_MUTATE || !guardSP()) return [];
  const session = sessionNonce();
  const me = localPlayerId();
  const flips = readFlips().filter(isBeyond3);
  const out = [];
  const snap = (city, idx, loc) => ({
    blocked: tilePlacement(city, idx)?.isBlocked ?? null,
    rural: constructiblesAt(loc).length,
    cap: cityWorkerCap(city), numWorkers: cityNumWorkers(city),
  });
  for (const flip of flips) {
    const loc = flip.loc;
    if (owningPlayerIdAt(loc) !== me) continue;
    const idx = plotIndexXY(loc);
    const { city, buildCID } = cityForPlot(loc);
    const before = snap(city, idx, loc);
    const worker = assignWorker(me, idx);
    const rural = createRuralDistrict(loc, me, buildCID);
    const claim = growthClaimPlot(city, loc);
    const after = snap(city, idx, loc);
    recordWork({ loc, verb: flip.verb, session, before, immediateAfter: after, ops: { worker, rural, claim } });
    emitLine(`Q-WORK-MUTATE ${flip.verb} loc=${loc.x},${loc.y} worker=${worker.ok} rural=${rural.ok} claim=${claim.ok} `
      + `blocked ${before.blocked}->${after.blocked} rural ${before.rural}->${after.rural} `
      + `numWorkers ${before.numWorkers}->${after.numWorkers} cap ${before.cap}->${after.cap}`);
    out.push({ loc, worker, rural, claim, before, after });
  }
  emitLine(`Q-WORK-MUTATE done: ${out.length} far tile(s) worked. SAVE & RELOAD to judge Q-WORK-PERSIST.`);
  return out;
}

// Per-verb near/far workability, so the control holds the CLAIM VERB constant and isolates
// distance: a far BLOCKED only implicates RANGE if the SAME verb's near tile was workable
// (else the block is the verb not attaching a city, not the distance).
function perVerbWork(rows) {
  const byVerb = {};
  for (const r of rows) {
    if (!r.ownerIsMe) continue;
    const v = (byVerb[r.verb] ||= { nearWork: false, farWork: false, hasNear: false, hasFar: false });
    if (r.beyondCap) { v.hasFar = true; if (r.verdict === "WORKABLE") v.farWork = true; }
    else { v.hasNear = true; if (r.verdict === "WORKABLE") v.nearWork = true; }
  }
  return byVerb;
}

export function runWork(trigger) {
  const runId = newRunId();
  const flips = readFlips();
  // Process ALL recorded flips so we keep a NEAR (ring 1-2) CONTROL alongside the far tiles.
  // canStart(ASSIGN_WORKER) is also false when no worker/pop is pending (nothing to do with
  // range), so a far-blocked result only implicates RANGE if the same verb's near control is
  // workable.
  const rows = flips.map(workSnapshot);
  const farOwned = rows.filter((r) => r.beyondCap && r.ownerIsMe);
  const nearOwned = rows.filter((r) => !r.beyondCap && r.ownerIsMe);
  const byVerb = perVerbWork(rows);

  emitLine(`RUN_START work ${runId} trigger=${trigger} tiles=${rows.length} `
    + `far=${farOwned.length} nearControl=${nearOwned.length} mutate=${AUTO.WORK_MUTATE}`);
  for (const r of rows) {
    const tag = r.beyondCap ? "far" : "NEAR-control";
    emitLine(`Q-WORK ${r.verb}/${r.kind} [${tag}] loc=${r.loc.x},${r.loc.y} `
      + `ownerIsMe=${r.ownerIsMe} canAssignWorker=${r.canAssignWorker} inExpandSet=${r.inExpandSet} `
      + `isBlocked=${r.isBlocked} yield=${r.yieldTotal} rural=${r.ruralDistrictCount} => ${r.verdict}`);
  }

  // Verdict, verb-paired. WORKABLE if any verb works a far tile; BLOCKED(range) only if a
  // verb's near control passed while its far failed; else INCONCLUSIVE / PENDING.
  const workVerbs = Object.keys(byVerb).filter((v) => byVerb[v].farWork);
  const rangeBlockedVerbs = Object.keys(byVerb).filter((v) => byVerb[v].hasFar && byVerb[v].nearWork && !byVerb[v].farWork);
  let verdict, human;
  if (!farOwned.length) {
    verdict = "PENDING"; human = "pending (no beyond-ring-3 owned tile yet)";
  } else if (workVerbs.length) {
    verdict = "WORKABLE"; human = `WORKABLE via [${workVerbs.join(",")}] - a city CAN work/settle the outer ring (1c feasible)`;
  } else if (rangeBlockedVerbs.length) {
    verdict = "BLOCKED"; human = `BLOCKED - [${rangeBlockedVerbs.join(",")}] works a near tile but NOT a far one => native refuses to work beyond ring 3 (1c NOT feasible)`;
  } else {
    verdict = "INCONCLUSIVE";
    human = "INCONCLUSIVE - no verb's near control was workable (no worker/pop pending, or the claim did not attach a city). Grow a pop and re-run cd_probe.work().";
  }
  hudVerdict(`OUTER-TILES: ${human}`, "work");
  emitLine(`Q-WORK-ROLLUP: beyond-ring-3 owned tiles => ${verdict} `
    + `(workableVerbs=[${workVerbs.join(",")}], rangeBlockedVerbs=[${rangeBlockedVerbs.join(",")}]). `
    + `WORKABLE => (1c) buildable; the listed verb is the one the outer-ring flip must use. `
    + `BLOCKED => (1c) not achievable; ship territory + rival-capture only. `
    + `INCONCLUSIVE => no worker was pending / claim did not attach; grow a pop and re-run cd_probe.work().`);

  // (E) worked-state persistence: for any mutate-marker from a PRIOR session, re-read the
  // tile NOW and report whether the placed worker/rural district survived the reload.
  const reloadedMarks = readWork().filter((m) => m.session && m.session !== sessionNonce());
  for (const m of reloadedMarks) {
    const { city } = cityForPlot(m.loc);
    const idx = plotIndexXY(m.loc);
    const nowRural = constructiblesAt(m.loc).length;
    const nowBlocked = tilePlacement(city, idx)?.isBlocked ?? null;
    const placedRural = (m.immediateAfter?.rural || 0) > (m.before?.rural || 0);
    emitLine(`Q-WORK-PERSIST loc=${m.loc.x},${m.loc.y} placedRural=${placedRural} `
      + `rural ${m.immediateAfter?.rural}->${nowRural} nowBlocked=${nowBlocked} `
      + `=> workedStateSurvived=${placedRural ? nowRural > 0 : "n/a"}`);
  }

  emitSection(runId, "cd_work", {
    probe_version: PROBE_VERSION, trigger, rows,
    rollup: { verdict, workableVerbs: workVerbs, rangeBlockedVerbs, byVerb, farCount: farOwned.length, nearCount: nearOwned.length },
  });
  emitLine(`RUN_END work ${runId}`);
  return rows;
}

// --- Q-CAPTURE (D): does capturing a DEVELOPED rival tile bring the improvement across? --
export function runCapture(trigger) {
  const runId = newRunId();
  const me = localPlayerId();
  const rivals = readFlips().filter((f) => typeof f.kind === "string" && f.kind.indexOf("rival") >= 0);
  emitLine(`RUN_START capture ${runId} trigger=${trigger} rivalFlips=${rivals.length}`);
  const rows = rivals.map((f) => {
    const loc = f.loc;
    const now = plotSnapshot(loc);
    const developedBefore = (f.consBefore || 0) > 0;
    const ownerNowMe = now.owner === me;
    let v;
    if (!developedBefore) v = "N/A-bare";                   // rival tile had no improvement to take
    else if (!ownerNowMe) v = "NOT-CAPTURED";               // flip didn't hold
    else if ((now.constructibleCount || 0) > 0) v = "TRANSFERRED"; // came across developed
    else v = "STRIPPED";                                    // ours now, but improvement gone
    emitLine(`Q-CAPTURE ${f.verb} loc=${loc.x},${loc.y} ringDepth=${f.ringDepth} developedBefore=${developedBefore} `
      + `consBefore=${f.consBefore} consNow=${now.constructibleCount} distOwnerNow=${now.districtOwner} `
      + `ownerNowMe=${ownerNowMe} => ${v}`);
    return { loc, verb: f.verb, ringDepth: f.ringDepth, ownerNowMe, developedBefore, consBefore: f.consBefore, consNow: now.constructibleCount, verdict: v };
  });

  // Q-DEEP: did a tile INSIDE the rival's 3-ring (ringDepth 1-3) actually flip to us and hold?
  const inside = rows.filter((r) => typeof r.ringDepth === "number" && r.ringDepth >= 1 && r.ringDepth <= 3);
  const insideHeld = inside.filter((r) => r.ownerNowMe);
  for (const r of inside) {
    emitLine(`Q-DEEP loc=${r.loc.x},${r.loc.y} ringDepth=${r.ringDepth} ownerNowMe=${r.ownerNowMe} `
      + `improvement=${r.consNow > 0 ? "kept" : "gone"} => ${r.ownerNowMe ? "FLIPPED-INSIDE-RING" : "did-not-hold"}`);
  }
  hudVerdict(`DEEP-FLIP: inside a rival's 3-ring => ${inside.length
    ? (insideHeld.length ? `YES - flipped ${insideHeld.length}/${inside.length} inner tile(s) (ring ${insideHeld.map((r) => r.ringDepth).join("/")})` : "NO - inner-ring flips did not hold")
    : "pending (no inside-ring rival tile flipped yet)"}`, "deep");
  emitLine(`Q-DEEP-ROLLUP: inside-3-ring rival flips => `
    + `${inside.length ? (insideHeld.length ? "FLIPPED-INSIDE-RING" : "did-not-hold") : "none-inside-ring-yet"} `
    + `(${insideHeld.length}/${inside.length} held). YES => the engine lets us take tiles deep in a rival's worked `
    + `footprint (not just their frontier) - relaxing cityCoreProtection would let diffusion do it.`);

  const developed = rows.filter((r) => r.developedBefore);
  const anyTransferred = developed.some((r) => r.verdict === "TRANSFERRED");
  const anyStripped = developed.some((r) => r.verdict === "STRIPPED");
  hudVerdict(`CAPTURE: rival developed tiles => ${developed.length
    ? (anyTransferred ? "TRANSFERRED - you inherit the improvement/yields" : (anyStripped ? "STRIPPED - captured tile reverts to bare land" : "unclear"))
    : "pending (no developed rival tile flipped yet)"}`, "capture");
  emitLine(`Q-CAPTURE-ROLLUP: developed rival tiles => `
    + `${developed.length ? (anyTransferred ? "TRANSFERRED" : (anyStripped ? "STRIPPED" : "unclear")) : "none-developed-flipped-yet"}. `
    + `TRANSFERRED => organic capture yields developed land (2 delivers the satisfying feel). `
    + `STRIPPED => captured tiles revert to bare land; note it (may still be fine as territory).`);
  emitSection(runId, "cd_capture", { probe_version: PROBE_VERSION, trigger, rows });
  emitLine(`RUN_END capture ${runId}`);
  return rows;
}

// --- Q-FOUND (1a-found): can the owner found a NEW settlement on an owned outer tile? -----
// Opportunistic - needs a settler unit (VII has no settler-free settle check). Reflects the
// engine's own min-city-range / owned-territory rules.
export function runFound(trigger) {
  const runId = newRunId();
  const settler = localSettlerId();
  emitLine(`RUN_START found ${runId} trigger=${trigger} settler=${settler != null}`);
  if (settler == null) {
    hudVerdict("FOUND-OUTER: no settler unit - move a settler next to a claimed outer tile, then cd_probe.found()", "found");
    emitLine("Q-FOUND: no settler present. VII has no settler-free settle-validity read, so founding on an "
      + "owned outer tile can only be tested with a settler ADJACENT to it. Keep a settler and re-run cd_probe.found().");
    emitLine(`RUN_END found ${runId}`);
    return { settler: false };
  }
  const legal = settlerFoundPlots(settler);
  const legalSet = new Set(legal);
  const farOwned = readFlips().filter(isBeyond3);
  const rows = farOwned.map((f) => {
    const idx = plotIndexXY(f.loc);
    return { loc: f.loc, verb: f.verb, plotIndex: idx, foundable: idx >= 0 && legalSet.has(idx) };
  });
  const anyFoundable = rows.some((r) => r.foundable);
  for (const r of rows) emitLine(`Q-FOUND ${r.verb} loc=${r.loc.x},${r.loc.y} foundable=${r.foundable}`);
  hudVerdict(`FOUND-OUTER: ${rows.length
    ? (anyFoundable ? "FOUNDABLE - a settler may found on a claimed outer tile"
      : "not foundable from current settler position (base min-city-range / owned-territory rules) - expected near your cities")
    : `settler has ${legal.length} legal found plot(s); no far claimed tile recorded yet`}`, "found");
  emitLine(`Q-FOUND-ROLLUP: legalFoundPlots=${legal.length} farClaimedFoundable=${anyFoundable}. `
    + `FOUNDABLE => (1a-found) works. Not-foundable is EXPECTED (you generally can't plant a new city inside/beside your own `
    + `territory); move a settler beside an ISOLATED claimed tile to truly test.`);
  emitSection(runId, "cd_found", { probe_version: PROBE_VERSION, trigger, legalCount: legal.length, rows });
  emitLine(`RUN_END found ${runId}`);
  return { settler: true, legalCount: legal.length, rows };
}

// --- Q-SWAP (1b): can a tile be re-parented between the player's OWN cities? --------------
// VII has no base-game "transfer tile" UI, but city.purchasePlot / Growth.claimPlot re-parent
// a plot to the city they are called on - so a swap is buildable if the owning city actually
// changes A->B. Destructive (moves a real tile between your own cities), gated under
// AUTO.WORK_MUTATE; ownership writes are ASYNC so the verdict is read on a deferred re-read.
export function runSwap(trigger) {
  const runId = newRunId();
  if (!AUTO.WORK_MUTATE) { emitLine("Q-SWAP: skipped (AUTO.WORK_MUTATE off - it moves a real tile)"); return { skipped: true }; }
  if (!guardSP()) return { ok: false, reason: "guard" };
  const cities = localCities();
  if (cities.length < 2) {
    hudVerdict("SWAP: need 2+ of your cities to test tile transfer between settlements", "swap");
    emitLine(`Q-SWAP: only ${cities.length} local city - inter-city transfer needs 2+.`);
    return { cities: cities.length };
  }
  // A near owned tile that currently belongs to one of our cities, plus a DIFFERENT target city.
  let loc = null, fromId = -1;
  for (const f of readFlips().filter((r) => !isBeyond3(r))) {
    const c = owningCityIdAt(f.loc);
    if (typeof c === "number" && c >= 0) { loc = f.loc; fromId = c; break; }
  }
  const toCity = cities.find((c) => cidNum(c?.id) !== fromId);
  const fromCity = cities.find((c) => cidNum(c?.id) === fromId) || null;
  if (!loc || !toCity) {
    hudVerdict("SWAP: no movable owned tile yet (need a near claimed tile + a 2nd city)", "swap");
    emitLine("Q-SWAP: no near owned tile with a distinct target city available yet.");
    return { pending: true };
  }
  const before = owningCityIdAt(loc);
  const call = flipViaPurchasePlot(toCity, loc); // re-parent to city B
  emitLine(`RUN_START swap ${runId} trigger=${trigger} loc=${loc.x},${loc.y} from=${fromId} to=${cidNum(toCity.id)} call=${call.reason}`);
  // Deferred verdict (writes are async), then restore the tile to its original city.
  const finish = () => {
    const mid = owningCityIdAt(loc);
    const moved = typeof mid === "number" && mid === cidNum(toCity.id) && mid !== before;
    if (fromCity) flipViaPurchasePlot(fromCity, loc); // best-effort restore (harmless either way)
    hudVerdict(`SWAP: tile transfer between your cities => ${moved
      ? "TRANSFERRED - purchasePlot re-parents a plot to another of your cities (1b buildable, no base-game UI needed)"
      : "BLOCKED - purchasePlot did not re-parent the tile (owning city unchanged)"}`, "swap");
    emitLine(`Q-SWAP-CONFIRM loc=${loc.x},${loc.y} owningCity ${before}->${mid} (restoring to ${fromId}) => ${moved ? "TRANSFERRED" : "BLOCKED"}`);
    emitSection(runId, "cd_swap", { probe_version: PROBE_VERSION, trigger, loc, fromId, toId: cidNum(toCity.id), before, mid, moved });
    emitLine(`RUN_END swap ${runId}`);
  };
  try { setTimeout(finish, 2000); } catch (_) { finish(); }
  return { ok: true, loc, fromId, toId: cidNum(toCity.id) };
}

// Once-per-isolate re-arm guard. Even with the globalThis-mirrored store, if a mirror miss
// ever let meta read stale, this stops a SECOND destructive clearAll in the same session (the
// per-tick thrash the redesign-plan Phase 0 calls out) - we re-arm at most once per isolate.
function armReset() {
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  if (g.__cdProbeArmed === SCHEMA) return false; // already re-armed this session
  g.__cdProbeArmed = SCHEMA;
  return true;
}

export function autoRun(trigger) {
  if (!AUTO.ENABLED) return { phase: "disabled" };
  let meta = readMeta();
  // Re-arm: if the test schema changed (new probe build with new tests), wipe the prior
  // phase/flip log so the new tests actually run instead of reporting "done" - but ONLY the
  // first time this session, so a mid-session mirror miss can't wipe the flip log every turn
  // (the "schema changed x107" thrash). After the one-time reset, subsequent schema mismatches
  // just adopt the new schema without clearing.
  if (meta.schema !== SCHEMA) {
    if (armReset()) {
      clearAll();
      meta = { phase: "init", schema: SCHEMA };
      writeMeta(meta);
      emitLine(`autoRun: schema changed -> reset for new tests (schema=${SCHEMA})`);
    } else {
      meta.schema = SCHEMA;
      writeMeta(meta);
      emitLine("autoRun: schema mismatch after re-arm (mirror miss) -> adopting schema WITHOUT wiping flips");
    }
  }
  const session = sessionNonce();

  // Always emit the read-only diagnostics (includes the Q-PERSIST persistCheck for
  // any flips recorded in a prior session).
  const diag = runDiagnostics(trigger);

  // "Waiting" HUD line (redesign-plan Phase 0): PENDING verb/capture verdicts are EXPECTED on
  // a fresh/interior map with no rival or beyond-ring-3 tiles - say so on screen so PENDING
  // isn't mistaken for broken.
  const counts = (diag.candidates && diag.candidates.counts) || {};
  const rivalN = counts.rival || 0;
  const beyond3N = counts.unownedBeyond3 || 0;
  if (rivalN === 0 && beyond3N === 0) {
    hudVerdict("WAITING: play toward an AI border - no rival / beyond-ring-3 tiles yet (verb & capture stay PENDING until then)", "waiting");
  } else if (rivalN === 0) {
    // Far tiles exist but no rival border, so the rival-capture branch of the verb/capture
    // tests can't run - the unowned verb verdict is still valid, but say what's missing.
    hudVerdict(`BORDER: beyondRing3=${beyond3N}, rival=0 - verb tests run on unowned tiles; play toward an AI to test rival capture`, "waiting");
  } else {
    hudVerdict(`BORDER: rival=${rivalN} beyondRing3=${beyond3N} - running verb/capture tests`, "waiting");
  }

  // Read-only REFRESH every turn, so the on-screen verdicts stay live WITHOUT a console or
  // any button - and so Q-FOUND catches the turn a settler happens to sit next to an outer
  // tile. Safe to repeat: none of these mutate (the destructive stages are only in postFlip).
  if (readFlips().length) {
    if (AUTO.WORK_READ) runWork("turn-refresh");
    runCapture("turn-refresh");
    runFound("turn-refresh");
  }
  if (AUTO.VERB_PROBE && readVerb().length) runVerbRead("turn-refresh");

  // One-shot cost rule: measure purchasePlot on a contiguous vs a disconnected tile (self-guards).
  if (AUTO.COST_PROBE && trigger !== "retry") runCostProbe(trigger);
  // One-shot Phase 5 discovery: is there a runtime city-transfer API? (self-guards; read-only)
  if (AUTO.CITY_TRANSFER && trigger !== "retry") runCityTransfer(trigger);
  // Phase 5 REAL path: place a loyalty revolt marker (one-shot) + watch the recipient each turn.
  if (AUTO.REVOLT_MARKER && trigger !== "retry") runRevoltMarker(trigger);
  runRevoltWatch(trigger);

  // Visible, contiguous border growth (+ rival capture on contact) every turn - independent of
  // the one-shot Q-* tests. Skipped on the fast "retry" ticks so it advances ~once per turn.
  if (AUTO.DIFFUSION_DEMO && trigger !== "retry") runDiffusionDemo(trigger);

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
    const postFlip = (tag) => {
      runIntegration(tag);
      if (AUTO.VERB_PROBE) runVerbProbe(tag);     // Phase 0 gate: FREE-INTEGRATED / COSTS-GOLD / FAILS
      if (AUTO.WORK_MUTATE) runWorkMutate(tag);   // destructive confirm (records persistence markers)
      if (AUTO.WORK_MUTATE) runSwap(tag);         // 1b: destructive re-parent test between your cities
      if (AUTO.WORK_READ) runWork(tag);           // reads the (post-mutation) work verdict
      runCapture(tag);                            // D: did developed rival tiles transfer?
      runFound(tag);                              // 1a-found: opportunistic settle check
    };
    try { setTimeout(() => postFlip("post-flip"), 5000); } catch (_) { postFlip("post-flip-nodelay"); }
    emitLine("========================================================================");
    emitLine("cd-probe: FLIPS DONE. Integration/codex + outer-tile work read auto-runs in ~5s (Q-INTEGRATE / Q-WORK lines).");
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
      if (AUTO.VERB_PROBE) runVerbRead("reload"); // Q-VERB-PERSIST: did the FREE-INTEGRATED claim survive?
      if (AUTO.WORK_READ) runWork("reload");     // includes Q-WORK-PERSIST from prior-session markers
      runCapture("reload");
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
  verb: () => runVerbProbe("manual"),
  verbRead: () => runVerbRead("manual"),
  demo: () => runDiffusionDemo("manual"),
  cost: () => { const g = (typeof globalThis !== "undefined") ? globalThis : {}; g.__cdCostProbeDone = false; return runCostProbe("manual"); },
  cityXfer: () => { const g = (typeof globalThis !== "undefined") ? globalThis : {}; g.__cdXferDone = false; return runCityTransfer("manual"); },
  revolt: () => { const g = (typeof globalThis !== "undefined") ? globalThis : {}; g.__cdRevoltDone = false; return runRevoltMarker("manual"); },
  revoltWatch: () => runRevoltWatch("manual"),
  work: () => runWork("manual"),
  workMutate: () => runWorkMutate("manual"),
  capture: () => runCapture("manual"),
  found: () => runFound("manual"),
  swap: () => runSwap("manual"),
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
