// cd-outer-place.js
//
// Growth onto claimed land past ring 3. The game offers a growing settlement only tiles within three rings, but a tile
// the settlement owns farther out works like any other once it has a rural district held by that city. Watched
// 2026-11-12 on game 1.5.1 (docs/probe-history.md, "Outer tiles a settlement can work"): with a citizen waiting, a
// rural district created with the city as Parent, then the game's own improvement for the tile, then
// addRuralPopulation(-1) leaves the counts exactly as a native placement does (population 2, rural 1, waiting 0), the
// growth screen closes, and the tile's yields reach the city on the next turn.
//
// Leaf module: no UI imports, so the growth screen (cd-outer-growth.js) and an AI pass can both call it.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { isMultiplayer, ownerAt, owningCityIdAt, plotsInRadius } from "/cultural-diffusion/ui/cd-plots.js";
import { plotInventory, rebuild } from "/cultural-diffusion/ui/cd-teardown.js";
import { dlog } from "/cultural-diffusion/ui/cd-log.js";

/** The base game's work radius: tiles this close are the game's to offer. */
export const NATIVE_RING = 3;

/** @param {()=>*} fn @param {*} fallback */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {*} cityId @returns {*} The city, or null. */
function cityOf(cityId) {
  return safe(() => Cities.get(cityId), null) || null;
}

/** @param {*} city @returns {{x:number,y:number}|null} */
function locOfCity(city) {
  const l = safe(() => city.location, null);
  return l && typeof l.x === "number" ? { x: l.x, y: l.y } : null;
}

/** @param {*} city @returns {{owner:number, id:number}|null} The city's owner and numeric id. */
function idOf(city) {
  const cid = safe(() => city.id, null);
  if (!cid || typeof cid.id !== "number") return null;
  return { owner: typeof cid.owner === "number" ? cid.owner : safe(() => city.owner, -1), id: cid.id };
}

/** @param {*} city @returns {{pop:number, rural:number, pending:number}} */
export function countsOf(city) {
  return {
    pop: safe(() => city.population, 0),
    rural: safe(() => city.ruralPopulation, 0),
    pending: safe(() => city.pendingPopulation, 0)
  };
}

/** @param {{x:number,y:number}} loc @returns {{x:number,y:number}[]} The six neighbors (the query includes loc). */
function neighborsAt(loc) {
  return plotsInRadius(loc, 1).filter((p) => !(p.x === loc.x && p.y === loc.y));
}

/** Whether growth onto outer tiles may act at all: the mod on, and not a network game. */
export function outerGrowthAllowed() {
  return !!CONFIG.diffusionEnabled && !isMultiplayer();
}

/**
 * The improvement the game itself would put on the tile for this player, as a GameInfo row, or null when there is
 * none (a mountain, a natural wonder, open sea with nothing to fish).
 * @param {{x:number,y:number}} loc Plot. @param {number} owner Player id.
 * @returns {{raw:*, def:*}|null} The engine's own value and its row.
 */
export function nativeImprovementAt(loc, owner) {
  const raw = safe(() => Districts.getFreeConstructible({ x: loc.x, y: loc.y }, owner), null);
  if (raw == null || raw === -1) return null;
  const def = safe(() => GameInfo.Constructibles.lookup(raw), null);
  if (!def || def.ConstructibleClass !== "IMPROVEMENT") return null;
  return { raw, def };
}

/**
 * Whether the plot holds a district of this city (center, urban or rural): developed land the base game's adjacency
 * rule counts. A script-made rural district counts too (watched 2026-11-12: a ring-3 tile beside one was offered).
 * @param {{x:number,y:number}} loc Plot. @param {{owner:number, id:number}} cid The city.
 * @returns {boolean}
 */
function developedBy(loc, cid) {
  const inv = plotInventory(loc);
  return inv.resolvable && ownerAt(loc) === cid.owner && owningCityIdAt(loc) === cid.id;
}

/**
 * Whether one plot is a tile this city can grow onto past ring 3. Pure reads.
 * @param {*} city City object. @param {{x:number,y:number}} loc Plot.
 * @returns {string|null} null when it qualifies, else a short reason.
 */
export function outerRefusal(city, loc) {
  const cid = idOf(city);
  const at = locOfCity(city);
  if (!cid || !at) return "no-city";
  const d = safe(() => GameplayMap.getPlotDistance(at.x, at.y, loc.x, loc.y), -1);
  if (!(d > NATIVE_RING)) return "inside-native-ring";
  if (ownerAt(loc) !== cid.owner || owningCityIdAt(loc) !== cid.id) return "not-this-city";
  return tileRefusal(loc, cid);
}

/** The tile's own checks for outerRefusal, once it is known to be this city's and past ring 3. */
function tileRefusal(loc, cid) {
  const inv = plotInventory(loc);
  if (inv.districtId || inv.constructibles.length) return "occupied";
  if (safe(() => GameplayMap.isNaturalWonder(loc.x, loc.y), false)) return "wonder";
  if (!nativeImprovementAt(loc, cid.owner)) return "no-improvement";
  if (!neighborsAt(loc).some((n) => developedBy(n, cid))) return "not-beside-development";
  return null;
}

/**
 * The tiles past ring 3 this city may grow onto now, as plot indexes: owned by this city, bare, with an improvement
 * the game would place, and beside land the city has developed.
 * @param {*} city City object.
 * @returns {number[]} Plot indexes.
 */
export function outerCandidates(city) {
  if (!city || !outerGrowthAllowed()) return [];
  const plots = safe(() => city.getPurchasedPlots() || [], []);
  const out = [];
  for (const p of plots) {
    const loc = safe(() => GameplayMap.getLocationFromIndex(p), null);
    if (loc && outerRefusal(city, { x: loc.x, y: loc.y }) === null) out.push(p);
  }
  return out;
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

/** Plots a placement is running on, so a second click can't start a second one. */
const busy = new Set();

/**
 * Spend the city's waiting citizen on a tile past ring 3: the rural district and the game's improvement, both held by
 * the city, then the citizen the district added taken back, which is what spends the waiting one.
 * @param {*} cityId The city's ComponentID. @param {{x:number,y:number}} loc Plot.
 * @param {{pollMs?:number, waitMs?:number}} [opt] Timings (tests shorten them).
 * @returns {Promise<{ok:boolean, reason:string, counts:{pop:number, rural:number, pending:number}|null}>}
 */
export async function placeOuterCitizen(cityId, loc, opt = {}) {
  const city = cityOf(cityId);
  if (!city) return { ok: false, reason: "no-city", counts: null };
  const before = countsOf(city);
  const refused = placementRefusal(city, loc, before);
  if (refused) return { ok: false, reason: refused, counts: before };
  const key = `${loc.x},${loc.y}`;
  busy.add(key);
  try {
    return await placeNow(city, cityId, loc, before, { pollMs: opt.pollMs ?? 100, waitMs: opt.waitMs ?? 8000 });
  } finally {
    busy.delete(key);
  }
}

/** Why a placement can't start now, or null. */
function placementRefusal(city, loc, before) {
  if (!outerGrowthAllowed()) return "off";
  if (!(before.pending >= 1)) return "no-waiting-citizen";
  if (busy.has(`${loc.x},${loc.y}`)) return "busy";
  return outerRefusal(city, loc);
}

/** The placement itself, once placeOuterCitizen has cleared it. */
async function placeNow(city, cityId, loc, before, t) {
  const owner = idOf(city).owner;
  const def = nativeImprovementAt(loc, owner).def;
  if (!rebuild(loc, cityId, owner, def.$index)) return { ok: false, reason: "request-failed", counts: before };
  if (!await until(() => plotInventory(loc).resolvable, t.waitMs, t.pollMs)) {
    dlog(`outer growth ${loc.x},${loc.y}: the district did not land; the citizen stays waiting`);
    return { ok: false, reason: "district-missing", counts: countsOf(city) };
  }
  const has = () => plotInventory(loc).constructibles.some((c) => c.type === def.ConstructibleType);
  const improved = await until(has, t.waitMs, t.pollMs);
  // The district has already added a citizen; taking it back spends the waiting one, improvement or not, so the
  // counts never run ahead of the game's.
  safe(() => city.addRuralPopulation(-1));
  await until(() => countsOf(city).pending < before.pending, t.waitMs, t.pollMs);
  const after = countsOf(city);
  dlog(`outer growth ${loc.x},${loc.y}: ${def.ConstructibleType} improved=${improved} ` +
    `counts ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  const spent = after.pending < before.pending;
  return { ok: improved && spent, reason: improved ? "placed" : "improvement-missing", counts: after };
}
