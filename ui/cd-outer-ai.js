// cd-outer-ai.js
//
// The AI's side of outer-tile growth. The game places an AI's new citizen natively, inside rings 1-3, before any
// script hears that the AI's turn has begun, and a teardown of the AI's tiles sent during its own turn is ignored
// (engine-closed.md, 2026-11-12). So the AI's choice is made over: the tile it grew onto is noted during its turn, and
// at the start of the local player's next turn, if one of that settlement's claimed outer tiles is clearly the better
// tile, the citizen is moved there. Teardown first (the citizen goes with the district), then the outer tile's
// district and the game's own improvement for it (the citizen comes back). Watched 2026-11-12, runs 7 and 8
// (docs/probe-history.md): population 3 -> 2 -> 3, the old tile stays the AI's land, bare, and it held four turns.
//
// It moves a citizen only when that makes sense for the AI:
// - the outer tile yields more in total than the tile the AI picked, by at least MIN_GAIN (a tie keeps the AI's pick);
// - the AI's pick isn't on a resource, which the AI weighs for more than its yields;
// - the outer tile doesn't touch land of a player the AI is at war with;
// - the outer tile still touches the settlement's developed land once the old tile is bare.
// It acts only on an AI's own growth, once per growth, for major civilizations, and never in a network game.

import { outerCandidates, outerGrowthAllowed, nativeImprovementAt, countsOf } from "/cultural-diffusion/ui/cd-outer-place.js";
import { ownerAt, owningCityIdAt, plotsInRadius } from "/cultural-diffusion/ui/cd-plots.js";
import { plotInventory, teardown, rebuild } from "/cultural-diffusion/ui/cd-teardown.js";
import { dlog, log } from "/cultural-diffusion/ui/cd-log.js";

/** How much more total yield the outer tile must give before the AI's own pick is overruled. */
export const MIN_GAIN = 1;
const MARK = "__cdOuterAi";

/** @param {()=>*} fn @param {*} fallback */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

const key = (l) => `${l.x},${l.y}`;
const neighborsAt = (loc) => plotsInRadius(loc, 1).filter((p) => !(p.x === loc.x && p.y === loc.y));

/** Growths noted during AI turns, waiting for the local player's turn: plot key -> {cityId, owner, loc}. */
const noted = new Map();
/** The last review's verdict on each noted growth, newest last (for the logs and probes). */
const decisions = [];
/** @returns {Array<{at:string, city:number, verdict:string}>} The recent verdicts. */
export function recentDecisions() {
  return decisions.slice();
}
function decided(n, verdict) {
  decisions.push({ at: key(n.loc), city: n.cityId.id, owner: n.owner, verdict });
  if (decisions.length > 20) decisions.shift();
}

/** Plots this module is building on right now, so its own districts aren't noted as AI growth. */
const ours = new Set();

/**
 * The total yield a city gets from working the tile, from the same engine read as the growth screen's preview.
 * @param {{x:number,y:number}} loc @param {*} cityId @returns {number|null} null when unreadable.
 */
export function tileWorth(loc, cityId) {
  const idx = safe(() => GameplayMap.getIndexFromLocation(loc), -1);
  const pairs = safe(() => GameplayMap.getYieldsWithCity(idx, cityId), null);
  if (!Array.isArray(pairs)) return null;
  let sum = 0;
  for (const p of pairs) if (Array.isArray(p) && Number.isFinite(p[1])) sum += p[1];
  return sum;
}

/** @param {number} a @param {number} b @returns {boolean} Whether player a is at war with player b. */
function atWar(a, b) {
  return safe(() => Players.get(a).Diplomacy.isAtWarWith(b), false) === true;
}

/** Whether the tile touches land of a player `owner` is at war with. */
function exposed(loc, owner) {
  return neighborsAt(loc).some((n) => {
    const o = ownerAt(n);
    return o >= 0 && o !== owner && atWar(owner, o);
  });
}

/** Whether the tile touches developed land of this city other than `skip` (the tile about to be cleared). */
function besideDevelopment(loc, cid, skip) {
  return neighborsAt(loc).some((n) => !(n.x === skip.x && n.y === skip.y) && plotInventory(n).resolvable &&
    ownerAt(n) === cid.owner && owningCityIdAt(n) === cid.id);
}

/** The outer tile at plot index `p` judged against the AI's pick, or null when it doesn't beat it. */
function judged(p, cid, from, fromWorth) {
  const l = safe(() => GameplayMap.getLocationFromIndex(p), null);
  if (!l) return null;
  const loc = { x: l.x, y: l.y };
  if (!besideDevelopment(loc, cid, from) || exposed(loc, cid.owner)) return null;
  const worth = tileWorth(loc, cid);
  if (worth == null || worth - fromWorth < MIN_GAIN) return null;
  return { loc, gain: worth - fromWorth, worth, fromWorth };
}

/**
 * The better outer tile for a citizen the AI just placed on `from`, or null to keep the AI's pick. Pure reads.
 * @param {*} city The AI's city. @param {{x:number,y:number}} from The tile it grew onto.
 * @returns {{loc:{x:number,y:number}, gain:number, worth:number, fromWorth:number}|null}
 */
export function betterOuterTile(city, from) {
  const cid = safe(() => city.id, null);
  if (!cid) return null;
  if (safe(() => GameplayMap.getResourceType(from.x, from.y), -1) !== -1) return null; // the AI's resource pick stays
  const fromWorth = tileWorth(from, cid);
  if (fromWorth == null) return null;
  let best = null;
  for (const p of outerCandidates(city)) {
    const j = judged(p, cid, from, fromWorth);
    if (j && (!best || j.worth > best.worth)) best = j;
  }
  return best;
}

/**
 * Wait until `test()` holds, polling, or until `maxMs` has passed.
 * @param {()=>boolean} test @param {number} maxMs @param {number} pollMs @returns {Promise<boolean>}
 */
function until(test, maxMs, pollMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (safe(test, false)) return resolve(true);
      if (Date.now() - t0 >= maxMs) return resolve(safe(test, false));
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

/** Teardown of `from`, waited for. @returns {Promise<boolean>} Whether it showed on the map. */
async function clearTile(from, t) {
  teardown(plotInventory(from));
  return until(() => {
    const now = plotInventory(from);
    return now.constructibles.length === 0 && !now.resolvable;
  }, t.waitMs, t.pollMs);
}

/** The outer tile built for the city, or the old tile rebuilt when the new district never lands. */
async function buildOuter(m, oldImp, imp, t) {
  const { cityId, owner, from, to } = m;
  rebuild(to, cityId, owner, imp.def.$index);
  if (!await until(() => plotInventory(to).resolvable, t.waitMs, t.pollMs)) {
    rebuild(from, cityId, owner, oldImp ? oldImp.index : -1);
    await until(() => plotInventory(from).resolvable, t.waitMs, t.pollMs);
    return "district-missing-restored";
  }
  const has = () => plotInventory(to).constructibles.some((c) => c.type === imp.def.ConstructibleType);
  await until(has, t.waitMs, t.pollMs);
  return "moved";
}

/**
 * Move the citizen on `from` to `to`: teardown, then the outer tile's district and improvement for the same city.
 * If the new district never lands, the old tile is rebuilt as it was so the AI keeps its citizen.
 * @returns {Promise<{ok:boolean, reason:string, before:*, after:*}>}
 */
export async function moveCitizen(cityId, owner, from, to, opt = {}) {
  const t = { pollMs: opt.pollMs ?? 150, waitMs: opt.waitMs ?? 8000 };
  const city = safe(() => Cities.get(cityId), null);
  if (!city) return { ok: false, reason: "no-city", before: null, after: null };
  const before = countsOf(city);
  const oldImp = plotInventory(from).constructibles.find((c) => c.cls === "IMPROVEMENT") || null;
  const imp = nativeImprovementAt(to, owner);
  if (!imp) return { ok: false, reason: "no-improvement", before, after: before };
  ours.add(key(from)); ours.add(key(to));
  try {
    if (!await clearTile(from, t)) return { ok: false, reason: "teardown-ignored", before, after: countsOf(city) };
    const reason = await buildOuter({ cityId, owner, from, to }, oldImp, imp, t);
    const after = countsOf(city);
    return { ok: reason === "moved" && after.pop === before.pop, reason, before, after };
  } finally {
    ours.delete(key(from)); ours.delete(key(to));
  }
}

/**
 * Whether a district for player `p` landing now is that AI's own growth: an AI major, outside the local player's turn.
 * The AI's placement can land before its turn reads as active (lab run 9, 2026-11-12: nothing was noted while this
 * also asked for isTurnActive), and Cultural Diffusion's own builds for an AI (flips, these moves) happen during the
 * local player's turn.
 */
function aiTurnOf(p) {
  const pl = safe(() => Players.get(p), null);
  const localActive = safe(() => Players.get(GameContext.localPlayerID).isTurnActive, true);
  return !!pl && !pl.isHuman && !!pl.isMajor && !localActive;
}

/** A rural district an AI settlement placed during its turn: noted for the local player's next turn. */
export function noteAiGrowth(data) {
  const cid = data && data.cityID;
  const loc = data && data.location;
  if (!cid || !loc || ours.has(key(loc)) || !outerGrowthAllowed() || !aiTurnOf(cid.owner)) return false;
  noted.set(key(loc), { cityId: cid, owner: cid.owner, loc: { x: loc.x, y: loc.y } });
  return true;
}

/** Whether the noted tile is still that city's rural tile. */
function stillTheirs(n) {
  const inv = plotInventory(n.loc);
  return inv.resolvable && inv.districtType === "RURAL" && owningCityIdAt(n.loc) === n.cityId.id;
}

/** One noted growth decided and, when an outer tile is clearly better, moved.
 * @returns {Promise<*>} The move, or null. */
async function review(n, opt) {
  const city = safe(() => Cities.get(n.cityId), null);
  if (!city || !stillTheirs(n)) { decided(n, "gone"); return null; }
  const pick = betterOuterTile(city, n.loc);
  if (!pick) {
    decided(n, `kept (worth ${tileWorth(n.loc, n.cityId)}, resource ${safe(() => GameplayMap.getResourceType(n.loc.x, n.loc.y), "?")}, ` +
      `outer candidates ${outerCandidates(city).length})`);
    return null;
  }
  const r = await moveCitizen(n.cityId, n.owner, n.loc, pick.loc, opt);
  decided(n, `${r.reason} to ${key(pick.loc)}`);
  log(`outer AI: player ${n.owner} city ${n.cityId.id} ${key(n.loc)} -> ${key(pick.loc)} ` +
    `(worth ${pick.fromWorth} -> ${pick.worth}): ${r.reason} ${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)}`);
  return { from: n.loc, to: pick.loc, ...r };
}

/** At the start of the local player's turn: decide on each noted growth, one move per settlement. */
export async function reviewAiGrowth(opt = {}) {
  const items = [...noted.values()];
  noted.clear();
  if (!outerGrowthAllowed()) return [];
  const done = new Set();
  const out = [];
  for (const n of items) {
    const ck = `${n.cityId.owner}:${n.cityId.id}`;
    if (done.has(ck)) continue;
    const m = await review(n, opt);
    if (m) { done.add(ck); out.push(m); }
  }
  return out;
}

function install() {
  if (globalThis[MARK]) return;
  globalThis[MARK] = true;
  safe(() => engine.on("DistrictAddedToMap", (d) => { safe(() => noteAiGrowth(d)); }));
  safe(() => engine.on("PlayerTurnActivated", (d) => {
    if (!safe(() => d.player === GameContext.localPlayerID, false)) return;
    reviewAiGrowth().catch((e) => dlog(`outer AI threw ${String(e)}`));
  }));
}

install();
