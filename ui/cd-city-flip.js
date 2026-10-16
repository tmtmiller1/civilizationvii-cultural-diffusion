// cd-city-flip.js
//
// Whole-settlement flips (mod_ideas_tested/liberation/cd-city-flip/SPEC.md). Once per pass, after the tile flips, every
// major's settlement whose center lies in the field is scored with the rule in cd-city-flip-rule.js. When a
// neighbor's culture has clearly won the center and most of the settlement's plots for cityFlipHoldPasses passes
// running, the settlement joins that civilization through the engine's own transfer: a marker building in the center
// fires that leader's EFFECT_CITY_TRANSFER_OWNER modifier (data/cd-city-flip.sql), which moves the center, every plot,
// the districts and the buildings in one step (watched 2026-10-14: about 110 ms, 7 of 7 plots kept). On
// CityTransfered the marker comes out, the settlement's plots are booked together, the civ that lost it holds
// grievances against the receiver, and the local player is told when either side is theirs.
//
// This path doesn't pass through any tile gate (core protection, the urban/center/wonder refusal, adjacency, the
// strand guard, the per-city cap) and never sends purchasePlot: the center moves only with its settlement. Its own
// gates are the rule's. tests/city-flip.mjs fails if this file or the rule reaches for a tile gate.
//
// The transfer lands after the request returns, so the flip runs after the pass has saved its state: it waits for
// CityTransfered (or re-reads the center's owner) for up to cityFlipWaitMs, then loads, books and saves on its own.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { log, dlog } from "/cultural-diffusion/ui/cd-log.js";
import {
  allSettlements, cityLoc, cityIdOf, isMultiplayer, isDistantLands, ownerAt, localPlayerId, plotsInRadius,
  districtTypeNameAt
} from "/cultural-diffusion/ui/cd-plots.js";
import { currentAgeKey } from "/cultural-diffusion/ui/cd-polity.js";
import { atWar, isMajorPlayer } from "/cultural-diffusion/ui/cd-borders.js";
import { ageTransitionPaused } from "/cultural-diffusion/ui/cd-age-guard.js";
import { cityPlots, transferCityCulture } from "/cultural-diffusion/ui/cd-capture.js";
import { loadState, saveState } from "/cultural-diffusion/ui/cd-state.js";
import { notifySettlement } from "/cultural-diffusion/ui/cd-notifications.js";
import {
  markerFor, isFlipMarker, strongestOn, centreWon, plotShareLed, landShareOf, cityFlipRefusal, nextHold, flipDue,
  pickFlips
} from "/cultural-diffusion/ui/cd-city-flip-rule.js";

/** @param {()=>*} fn @param {*} fallback */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {{x:number,y:number}} p @returns {string} */
function key(p) {
  return `${p.x},${p.y}`;
}

/** The flip waiting on its transfer, or null. One at a time. */
let _inFlight = /** @type {{centre:{x:number,y:number}, leader:number, event:*}|null} */ (null);

/** @param {number} pid @returns {number} The player's team, or -1. */
function teamOf(pid) {
  return safe(() => {
    const t = Players.get(pid).team;
    return typeof t === "number" ? t : -1;
  }, -1);
}

/** @returns {Map<number, number>} Settlements per major owner. */
function settlementCounts() {
  const out = new Map();
  for (const { owner } of allSettlements(false)) out.set(owner, (out.get(owner) || 0) + 1);
  return out;
}

/** @returns {{paused:boolean, multiplayer:boolean, counts:Map<number,number>}} What holds every settlement alike. */
function readEnv() {
  return { paused: ageTransitionPaused(), multiplayer: isMultiplayer(), counts: settlementCounts() };
}

/**
 * Score one settlement: who leads its center, whether that leader has clearly won the center and the plots, and the
 * gate that holds it, if any.
 * @param {*} city Engine city. @param {number} owner Its owner.
 * @param {{field:Record<string, Record<string, number>>, dead:number[], cfg:*, env:*}} ctx Field, dead civs,
 *   age-adjusted config and readEnv().
 * @returns {{key:string, centre:{x:number,y:number}, owner:number, leader:number, lead:number, share:number,
 *   won:boolean, refusal:string|null}|null} The score, or null when the city is unreadable.
 */
export function settlementStatus(city, owner, ctx) {
  const centre = cityLoc(city);
  if (!centre) return null;
  const k = key(centre);
  const row = ctx.field[k];
  const { leader, value } = strongestOn(row, ctx.dead);
  const refusal = cityFlipRefusal(readFacts(city, owner, leader, centre, ctx.env), ctx.cfg);
  const centreClear = centreWon(row, leader, owner, ctx.cfg);
  const share = centreClear ? plotShareLed(cityPlots(city).map((p) => ctx.field[key(p)]), leader, ctx.dead) : 0;
  const plotsWon = centreClear && share >= Math.max(0, ctx.cfg.cityFlipPlotShare);
  const land = plotsWon ? countryside(centre, owner, leader, ctx.cfg) : { leaderOwned: 0, ownerRural: 0, share: 0 };
  const landNeed = Math.max(0, n0(ctx.cfg.cityFlipLandShare, 0.6));
  const won = plotsWon && land.share >= landNeed;
  const ownerStock = row ? n0(row[String(owner)]) : 0;
  return { key: k, centre, owner, leader, lead: value, ownerStock, share, land, won, refusal,
    landShort: plotsWon && !won };
}

/** @param {*} v @param {number} [d] @returns {number} */
function n0(v, d = 0) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/**
 * What the leader already holds of the settlement's countryside: its plots within cityFlipLandRadius of the center
 * against the owner's rural plots there, the ones tile flips can take. Urban districts and the center itself don't
 * count either way: they only ever move with the settlement.
 * @param {{x:number,y:number}} centre The center. @param {number} owner Its owner. @param {number} leader The leader.
 * @param {{cityFlipLandRadius:number}} cfg Config.
 * @returns {{leaderOwned:number, ownerRural:number, share:number}}
 */
function countryside(centre, owner, leader, cfg) {
  const r = Math.max(1, Math.floor(n0(cfg.cityFlipLandRadius, 3)));
  let leaderOwned = 0;
  let ownerRural = 0;
  for (const p of plotsInRadius(centre, r)) {
    if (p.x === centre.x && p.y === centre.y) continue;
    const o = ownerAt(p);
    if (o === leader) leaderOwned++;
    else if (o === owner) {
      const d = districtTypeNameAt(p);
      if (!d || /RURAL|WILDERNESS/.test(d)) ownerRural++;
    }
  }
  return { leaderOwned, ownerRural, share: landShareOf(leaderOwned, ownerRural) };
}

/** The facts the rule's gates ask about (cd-city-flip-rule.js SettlementFacts). */
function readFacts(city, owner, leader, centre, env) {
  const rival = leader >= 0 && leader !== owner;
  return {
    owner, leader,
    ownerMajor: isMajorPlayer(owner),
    leaderMajor: leader >= 0 && isMajorPlayer(leader),
    sameTeam: rival && teamOf(owner) >= 0 && teamOf(owner) === teamOf(leader),
    atWar: rival && atWar(owner, leader),
    isCapital: !!safe(() => city.isCapital, false),
    ownerSettlements: env.counts.get(owner) || 0,
    distantLands: rival && distantForLeader(leader, centre),
    paused: env.paused,
    multiplayer: env.multiplayer
  };
}

/** Before Exploration a civ claims nothing in its distant lands (the base game's rule), so it can't gain one whole. */
function distantForLeader(leader, centre) {
  if (!CONFIG.blockDistantLandsBeforeExploration || currentAgeKey() !== "ANTIQUITY") return false;
  return isDistantLands(leader, centre);
}

/** The settlement standing on a center plot, or null. City lists, not MapCities.getCity (engine-closed.md). */
function settlementAt(loc) {
  for (const s of allSettlements(false)) {
    const at = cityLoc(s.city);
    if (at && at.x === loc.x && at.y === loc.y) return s;
  }
  return null;
}

/**
 * The plots of every settlement that may flip this pass (its hold is one pass short of the bar, or past it). The tile
 * path leaves them alone, so nothing buys a plot of a settlement that's about to change hands whole.
 * @param {import("/cultural-diffusion/ui/cd-state.js").CdState} state Loaded state.
 * @returns {Set<string>} Plot keys.
 */
export function settlementBusyKeys(state) {
  const out = new Set();
  if (!CONFIG.cityFlips || !state || !state.cityHold) return out;
  const need = Math.max(1, Math.floor(CONFIG.cityFlipHoldPasses));
  for (const k of Object.keys(state.cityHold)) {
    if (state.cityHold[k].n + 1 < need) continue;
    const i = k.indexOf(",");
    const s = settlementAt({ x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) });
    if (s) for (const p of cityPlots(s.city)) out.add(key(p));
  }
  return out;
}

/** @param {*} tag @returns {string} The tag in the game's language, or "". */
function compose(tag, ...args) {
  const s = safe(() => Locale.compose(tag, ...args), "");
  return typeof s === "string" ? s : "";
}

/** @param {number} pid @returns {string} The civilization's name ("Greece"). */
function civName(pid) {
  const p = safe(() => Players.get(pid), null);
  const tag = p ? (p.civilizationName || p.civilizationFullName || p.name) : null;
  return (tag && compose(tag)) || `#${pid}`;
}

/** @param {*} city @returns {string} */
function cityName(city) {
  const n = safe(() => city.name, null);
  return (n && compose(n)) || "?";
}

/** Tell the local player a settlement is wavering, when either side is theirs. */
function warn(city, owner, leader, at) {
  const me = localPlayerId();
  log(`city flip: ${cityName(city)} (${at.x},${at.y}) of player ${owner} leans to player ${leader}`);
  if (me !== owner && me !== leader) return;
  notifySettlement("warn", compose("LOC_CD_CITY_FLIP_WARNING", cityName(city), civName(leader)),
    compose("LOC_CD_CITY_FLIP_WARNING_TITLE"));
}

/**
 * Every later pass of a hold: how many turns are left before the settlement joins, when either side is the local
 * player's. The last one says "next turn". Nothing on the pass the flip happens; the joined notice follows it.
 */
function countdown(city, owner, leader, n) {
  const me = localPlayerId();
  if (me !== owner && me !== leader) return;
  const left = Math.max(1, Math.floor(CONFIG.cityFlipHoldPasses)) - n;
  if (left <= 0) return;
  const line = left === 1
    ? compose("LOC_CD_CITY_FLIP_COUNTDOWN_LAST", cityName(city), civName(leader))
    : compose("LOC_CD_CITY_FLIP_COUNTDOWN", cityName(city), civName(leader), left);
  notifySettlement("warn", line, compose("LOC_CD_CITY_FLIP_WARNING_TITLE"));
}

/**
 * The settlement flip step of a pass: advance every hold counter in the field, warn on a first pass, and pick the
 * settlements to flip. Counters wait unchanged through an age-transition window and in a network game.
 * @param {{state:*, next:Record<string, Record<string, number>>, region:Set<string>, ageCfg:*, deadOwners:number[]}} p
 *   Pass state: the new field, this pass's region and the age-adjusted config.
 * @returns {{tracked:number, due:number, launch:*[]}} Settlements holding, due, and the ones to flip now.
 */
export function cityFlipStep({ state, next, region, ageCfg, deadOwners }) {
  const out = { tracked: 0, due: 0, launch: [] };
  if (!state.cityHold) state.cityHold = {};
  if (!CONFIG.cityFlips) {
    state.cityHold = {};
    return out;
  }
  const env = readEnv();
  if (env.paused || env.multiplayer) return out;
  const due = scoreRegion(state, region, { field: next, dead: deadOwners || [], cfg: ageCfg, env }, out);
  out.due = due.length;
  if (_inFlight) return out;
  out.launch = pickFlips(due.filter((d) => !plotsPending(state, d.city, d.key)), CONFIG);
  return out;
}

/**
 * Score every major's settlement whose center is in the region and advance its hold counter; counters for
 * settlements no longer in the region go. Mutates state.cityHold and out.tracked.
 * @returns {*[]} The settlements whose hold has reached cityFlipHoldPasses.
 */
function scoreRegion(state, region, ctx, out) {
  const seen = new Set();
  const due = [];
  for (const { city, owner } of allSettlements(false)) {
    const s = settlementStatus(city, owner, ctx);
    if (!s || !region.has(s.key)) continue;
    seen.add(s.key);
    const hold = advance(state, s, city);
    if (!hold) continue;
    out.tracked++;
    if (flipDue(hold, CONFIG)) due.push({ ...s, city, hold });
  }
  for (const k of Object.keys(state.cityHold)) if (!seen.has(k)) delete state.cityHold[k];
  return due;
}

/** Advance one settlement's counter, warning on its first pass. @returns {*} The counter, or null when it reset. */
function advance(state, s, city) {
  const hold = nextHold(state.cityHold[s.key], s.leader, s.owner, s.won && !s.refusal);
  if (!hold) {
    delete state.cityHold[s.key];
    return null;
  }
  state.cityHold[s.key] = hold;
  if (hold.n === 1) warn(city, s.owner, s.leader, s.centre);
  else countdown(city, s.owner, s.leader, hold.n);
  dlog(`city flip: ${s.key} held ${hold.n} pass(es) by player ${s.leader} (share ${s.share.toFixed(2)}, `
    + `land ${s.land.leaderOwned}:${s.land.ownerRural})`);
  return hold;
}

/** Whether a tile verb on one of the settlement's plots is still landing; the flip then waits a pass. */
function plotsPending(state, city, k) {
  const pending = state.pending || {};
  const busy = cityPlots(city).some((p) => !!pending[key(p)]);
  if (busy) log(`city flip: ${k} waits a pass, a tile change on one of its plots is still landing`);
  return busy;
}

/** @param {number} pid @returns {string|null} The player's LeaderType. */
function leaderTypeOf(pid) {
  return safe(() => GameInfo.Leaders.lookup(Players.get(pid).leaderType).LeaderType, null);
}

/** @param {string} kind @param {*} args @returns {boolean} Whether the request went out (as the local player). */
function request(kind, args) {
  const me = localPlayerId();
  if (me < 0) return false;
  return safe(() => {
    Game.PlayerOperations.sendRequest(me, kind, args);
    return true;
  }, false);
}

/** The city standing on a center now, re-read (its ComponentID changes with its owner). */
function cityAtCentre(at) {
  const s = settlementAt(at);
  return s ? s.city : null;
}

/** @param {*} city @returns {{owner:number, id:number}[]} The flip markers in a city. */
function markersIn(city) {
  const out = [];
  for (const id of safe(() => city.Constructibles.getIds(), []) || []) {
    const t = safe(() => GameInfo.Constructibles.lookup(Constructibles.getByComponentID(id).type).ConstructibleType, "");
    if (isFlipMarker(t)) out.push({ owner: id.owner, id: id.id });
  }
  return out;
}

/** Remove every flip marker in a city. @returns {number} Removals sent. */
function removeMarkers(city) {
  let n = 0;
  if (!city) return n;
  for (const m of markersIn(city)) {
    if (request("DESTROY_ELEMENT", { Kind: "CONSTRUCTIBLE", Owner: m.owner, LocalID: m.id })) n++;
  }
  return n;
}

/**
 * Remove every stray flip marker on the map: on load and at each age start (a marker carries over an age change, and
 * one left in a city would hand it back to that leader if it ever changed hands again). Skipped while a flip waits.
 * @returns {number} Removals sent.
 */
export function sweepFlipMarkers() {
  if (_inFlight) return 0;
  let n = 0;
  for (const { city } of allSettlements(false)) n += removeMarkers(city);
  if (n) dlog(`city flip: sweep sent ${n} marker removal(s)`);
  return n;
}

/** @returns {boolean|null} Whether the game has started (Begin Game pressed), or null when the build can't say. */
function gameStarted() {
  return safe(() => {
    if (typeof UI.getGameLoadingState !== "function" || typeof UIGameLoadingState === "undefined") return null;
    return UI.getGameLoadingState() === UIGameLoadingState.GameStarted;
  }, null);
}

/** @returns {number} Flip markers standing in any major's settlement now. */
function strayCount() {
  let n = 0;
  for (const { city } of allSettlements(false)) n += markersIn(city).length;
  return n;
}

/**
 * Sweep for stray markers once the game has started, and keep at it until they're gone. Nothing a script sends lands
 * while the load screen waits for Begin Game, and a removal sent the moment the loading state first reads GameStarted
 * was still lost at a new age's start (both watched 2026-10-15), so this waits for GameStarted plus `settleMs`, sweeps,
 * re-reads after `pollMs` and sweeps again while any marker stands, up to `tries` times.
 * @param {{pollMs?:number, settleMs?:number, tries?:number, maxMs?:number}} [o]
 * @returns {Promise<{sent:number, left:number}>} Removals sent, and markers still standing at the end.
 */
export function sweepWhenStarted({ pollMs = 3000, settleMs = 3000, tries = 5, maxMs = 30 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const started = async () => {
    while (Date.now() - t0 < maxMs) {
      const s = gameStarted();
      if (s === true || (s === null && Date.now() - t0 >= 5000)) return true;
      await wait(pollMs);
    }
    return false;
  };
  return started().then(async (ok) => {
    let sent = 0;
    if (!ok) return { sent, left: strayCount() };
    await wait(settleMs);
    for (let i = 0; i < tries && strayCount() > 0; i++) {
      sent += sweepFlipMarkers();
      await wait(pollMs);
    }
    const left = strayCount();
    if (sent || left) log(`city flip: sweep sent ${sent} removal(s); ${left} stray marker(s) left`);
    return { sent, left };
  });
}

/**
 * CityTransfered, relayed by cd-bootstrap.js: note the transfer when it's the settlement a flip is waiting on.
 * Matched by location, since the city's id changes with its owner.
 * @param {*} data Event payload ({ fromPlayer, transferType, cityID }).
 */
export function onSettlementTransfer(data) {
  if (!data) return;
  const city = safe(() => Cities.get(data.cityID), null);
  const at = cityLoc(city);
  if (!at) return;
  if (_inFlight && at.x === _inFlight.centre.x && at.y === _inFlight.centre.y) {
    _inFlight.event = data;
    return;
  }
  if (markersIn(city).length) landedLate(city, at, data);
}

/**
 * A transfer that arrived after its flip stopped waiting: requests sent while the game can't take them are queued
 * and land later (watched 2026-10-15, a marker sent behind the load screen landed once Begin Game was pressed).
 * The marker is still in the city; take it out and finish the flip as if it had landed in time.
 */
function landedLate(city, at, data) {
  const k = key(at);
  removeMarkers(city);
  const owner = typeof data.fromPlayer === "number" ? data.fromPlayer : -1;
  log(`city flip: ${k} landed after its wait; marker removed, settlement booked`);
  finish({ key: k, centre: at, owner, leader: city.owner }, { city, event: data, name: cityName(city), ms: -1 });
}

/** @param {()=>boolean} test @param {number} maxMs @param {number} pollMs @returns {Promise<boolean>} */
function until(test, maxMs, pollMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (safe(test, false)) return resolve(true);
      if (Date.now() - t0 >= maxMs) return resolve(false);
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

/**
 * Book a settlement that has changed hands: every plot that shows the new owner gets the new owner's claim (marked as
 * the settlement's, so no cap counts it and nothing releases or cedes it), the cooldown lock, and no pending tile
 * verb; the hold counter goes. A plot that doesn't show the new owner is logged and left alone, never patched with a
 * tile flip. Seeding follows the capture rule: cd-capture.js has already rewritten the field on CityTransfered when
 * captureTransfer is on, otherwise it's done here.
 * @param {import("/cultural-diffusion/ui/cd-state.js").CdState} state Loaded state (mutated).
 * @param {{key:string, plots:{x:number,y:number}[], leader:number, cityId:number}} f The flip.
 * @returns {{booked:number, wrong:string[]}} Plots booked, and plots that didn't show the new owner.
 */
export function bookSettlement(state, f) {
  const lock = Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
  const wrong = [];
  const good = [];
  for (const p of f.plots) {
    const k = key(p);
    if (ownerAt(p) !== f.leader) {
      wrong.push(k);
      continue;
    }
    good.push(p);
    state.claims[k] = { by: f.leader, city: f.cityId, turn: state.monoTurn, settlement: true };
    state.locked[k] = lock;
    if (state.pending) delete state.pending[k];
    if (state.occupation) delete state.occupation[k];
  }
  if (state.cityHold) delete state.cityHold[f.key];
  if (!CONFIG.captureTransfer) transferCityCulture(state, good, f.leader, CONFIG);
  return { booked: good.length, wrong };
}

/** Drop a settlement's hold counter after a refused flip. */
function resetHold(k) {
  const state = loadState();
  if (state.cityHold && state.cityHold[k]) {
    delete state.cityHold[k];
    saveState(state);
  }
}

/**
 * The grievance penalty: the civ that lost the settlement holds cityFlipGrievances against the receiver. The engine
 * books a grievance on the civ that did the wrong, so the write goes on the receiver, aimed at the loser.
 */
function penalise(owner, leader) {
  const n = Math.max(0, Math.floor(CONFIG.cityFlipGrievances));
  if (!n) return 0;
  const ok = safe(() => {
    Players.get(leader).Diplomacy.changeNumGrievances(owner, n * 1000);
    return true;
  }, false);
  if (!ok) dlog(`city flip: grievances held by player ${owner} against player ${leader} not written`);
  return ok ? n : 0;
}

/**
 * The "has joined" notice, sent cityFlipNoticeDelayMs after the transfer so Partisans has rolled for the flip in its
 * own CityTransfered handler. When Partisans says this settlement's people are arming, its line closes the notice.
 */
function announce(f, grievances) {
  const me = localPlayerId();
  if (me !== f.owner && me !== f.leader) return;
  setTimeout(() => {
    const lines = [compose("LOC_CD_CITY_FLIP_JOINED", f.name, civName(f.leader))];
    if (grievances > 0) {
      lines.push(compose("LOC_CD_CITY_FLIP_GRIEVANCES", civName(f.owner), civName(f.leader), grievances));
    }
    lines.push(partisansLine(f.key));
    notifySettlement("joined", lines.filter(Boolean).join("[N]"), compose("LOC_CD_CITY_FLIP_JOINED_TITLE"));
  }, Math.max(0, CONFIG.cityFlipNoticeDelayMs));
}

/** Partisans' line for a settlement whose people are arming, or "". Feature-detected; never imports Partisans. */
function partisansLine(k) {
  const outlook = safe(() => globalThis.__towerPartisans?.flipOutlook?.(k), null);
  return outlook && typeof outlook === "object" && typeof outlook.line === "string" ? outlook.line : "";
}

/**
 * Flip one settlement: place the leader's marker, wait for the transfer, then clean up, book, penalise and notify.
 * Returns at once; the promise reports what happened.
 * @param {{key:string, centre:{x:number,y:number}, owner:number, leader:number, city:*}} d A due settlement.
 * @returns {Promise<{ok:boolean, reason:string, ms?:number, booked?:number, wrong?:string[]}>}
 */
export function flipSettlement(d) {
  const leaderType = leaderTypeOf(d.leader);
  const marker = leaderType ? markerFor(leaderType) : null;
  const name = cityName(d.city);
  if (!marker || !safe(() => GameInfo.Constructibles.lookup(marker), null)) {
    log(`city flip refused ${d.key}: no marker for player ${d.leader} (${leaderType || "unknown leader"})`);
    resetHold(d.key);
    return Promise.resolve({ ok: false, reason: "no-marker" });
  }
  const t0 = Date.now();
  _inFlight = { centre: d.centre, leader: d.leader, event: null };
  const at = { x: d.centre.x, y: d.centre.y };
  const sent = request("CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: marker, Location: at, Owner: d.owner });
  log(`city flip: ${name} (${d.key}) from player ${d.owner} to player ${d.leader}, marker ${marker} ${sent ? "sent" : "NOT sent"}`);
  const landed = () => !!(_inFlight && _inFlight.event) || ownerAt(d.centre) === d.leader;
  const arrived = sent ? until(landed, Math.max(250, CONFIG.cityFlipWaitMs), 100) : Promise.resolve(false);
  return arrived.then((ok) => {
    const event = _inFlight && _inFlight.event;
    _inFlight = null;
    const city = cityAtCentre(d.centre);
    removeMarkers(city);
    if (!ok) {
      resetHold(d.key);
      log(`city flip refused ${d.key}: no transfer to player ${d.leader} within ${CONFIG.cityFlipWaitMs} ms; plots left as they were`);
      return { ok: false, reason: sent ? "no-transfer" : "not-sent" };
    }
    return finish(d, { city, event, name, ms: Date.now() - t0 });
  });
}

/** @param {*} t A CityTransferTypes value. @returns {string} Its name ("BY_CULTURAL_IDENTITY"), or the value. */
function transferName(t) {
  return safe(() => Object.keys(CityTransferTypes).find((k) => CityTransferTypes[k] === t), null) || String(t);
}

/** The tail of a flip that landed: book the plots together, penalise, notify. */
function finish(d, r) {
  const plots = r.city ? cityPlots(r.city) : [d.centre];
  const state = loadState();
  const res = bookSettlement(state, { key: d.key, plots, leader: d.leader, cityId: cityIdOf(r.city) });
  saveState(state);
  const type = r.event ? transferName(r.event.transferType) : "re-read";
  log(`city flip: ${r.name} (${d.key}) joined player ${d.leader} from player ${d.owner} in ${r.ms} ms (${type}); `
    + `${res.booked} of ${plots.length} plot(s) show the new owner`);
  if (res.wrong.length) log(`city flip: ${d.key} plot(s) not showing player ${d.leader}: ${res.wrong.join(" ")}`);
  const grievances = penalise(d.owner, d.leader);
  announce({ key: d.key, owner: d.owner, leader: d.leader, name: r.name }, grievances);
  return { ok: true, reason: "joined", ms: r.ms, booked: res.booked, wrong: res.wrong };
}

/**
 * Start the flips the step picked. Called after the pass has saved its state.
 * @param {*[]} list cityFlipStep(...).launch.
 * @returns {Promise<*>[]} One promise per flip.
 */
export function launchCityFlips(list) {
  const out = [];
  for (const d of list || []) {
    if (_inFlight) break;
    out.push(flipSettlement(d).catch((e) => {
      _inFlight = null;
      log(`city flip ${d.key} threw ${String(e)}`);
      return { ok: false, reason: "threw" };
    }));
  }
  return out;
}

/**
 * What the hover readout shows on a settlement's center: its leader, how many passes the leader has held it, and the
 * gate that holds it.
 * @param {{x:number,y:number}} loc Hovered plot.
 * @param {{field:*, dead:number[], cfg:*, state:*}} snap The readout's snapshot (saved field, age-adjusted config).
 * @returns {{leader:number, owner:number, n:number, need:number, won:boolean, refusal:string|null,
 *   landShort:boolean, lead:number, ownerStock:number, land:{leaderOwned:number, ownerRural:number,
 *   share:number}}|null} Null when no major's settlement stands there or the feature is off. `landShort`: the
 *   culture has won the center and the plots but the leader doesn't hold enough of the countryside yet.
 */
export function settlementOutlookAt(loc, snap) {
  if (!CONFIG.cityFlips) return null;
  const s = settlementAt(loc);
  if (!s) return null;
  const ctx = { field: snap.field || {}, dead: snap.dead || [], cfg: snap.cfg, env: readEnv() };
  const st = settlementStatus(s.city, s.owner, ctx);
  if (!st) return null;
  return { leader: st.leader, owner: s.owner, n: heldPasses(snap.state, st), won: st.won, refusal: st.refusal,
    landShort: st.landShort, lead: st.lead, ownerStock: st.ownerStock, land: st.land,
    need: Math.max(1, Math.floor(CONFIG.cityFlipHoldPasses)) };
}

/** Passes the current leader has held a settlement, from the saved counter. */
function heldPasses(state, st) {
  const hold = state && state.cityHold ? state.cityHold[st.key] : null;
  return hold && hold.by === st.leader && hold.owner === st.owner ? hold.n : 0;
}

/** Test hooks. */
export const __test = {
  inFlight: () => _inFlight,
  reset: () => { _inFlight = null; }
};
