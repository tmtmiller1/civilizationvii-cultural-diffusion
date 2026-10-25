// cd-borders.js
//
// Border resistance reads (docs/current-model.md §5): a rival's city-core ring never flips as a tile, and
// an active war pauses peaceful diffusion across the front. Pure helpers (isCoreProtected) are
// unit-testable; the war read is engine-guarded. A center changes hands only with its whole settlement
// (cd-city-flip.js), which never asks these tile gates.

import { plotsInRadius, cityLoc, cityIdOf, isCityCenterAt, ownerAt } from "/cultural-diffusion/ui/cd-plots.js";

/** @param {()=>*} fn @param {*} fallback */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * Settlement centers read once and reused for one sweep over many plots (a pass, a lens paint), set by
 * withCentreCache. Centers don't move inside a sweep: tile flips never take a center, and a settlement flip starts
 * only after the pass has saved. Outside a sweep every read goes to the engine.
 * @type {{listed: Map<string, number>|null, onMap: Map<string, number|null>}|null}
 */
let _centres = null;

/**
 * Run `fn` with settlement-center reads cached for its length. A nested call shares the outer cache.
 * @template T
 * @param {() => T} fn The sweep.
 * @returns {T} What `fn` returns.
 */
export function withCentreCache(fn) {
  const outer = _centres;
  if (!outer) _centres = { listed: null, onMap: new Map() };
  try {
    return fn();
  } finally {
    _centres = outer;
  }
}

/**
 * Whether a plot sits within `radius` rings of a protected city center (the "downtown" shield that
 * never flips): radius 1 = center + ring-1; 0 = only the city-center plot; < 0 = nothing protected.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner id whose core to protect (-1 = protect every owner's core).
 * @param {number} [radius] Protection radius in rings (default 1).
 * @returns {boolean} True when the plot is core-protected.
 */
export function isCoreProtected(plot, protectOwner, radius = 1) {
  if (typeof radius === "number" && radius < 0) return false;
  const r = Math.max(0, radius || 0);
  // Two routes on purpose. The player-list route sees a major's or city-state's cities; the map route
  // also sees settlements no city list reports: an Independent Power reads `cities: 0`, so the list
  // route alone leaves every village center unprotected (docs/BACKLOG.md).
  return _cityCenterWithin(plot, protectOwner, r) || _centerOnMapWithin(plot, protectOwner, r);
}

/**
 * The owner of the settlement center the map shows on this plot, or null when none stands there. Cached inside a
 * sweep (withCentreCache).
 * @param {{x:number,y:number}} p Plot.
 * @returns {number|null} Owner id, or null.
 * @private
 */
function _mapCentreOwner(p) {
  const k = `${p.x},${p.y}`;
  if (_centres && _centres.onMap.has(k)) return /** @type {number|null} */ (_centres.onMap.get(k));
  const owner = isCityCenterAt(p) ? ownerAt(p) : null;
  if (_centres) _centres.onMap.set(k, owner);
  return owner;
}

/**
 * Whether a settlement center read off the map sits within `radius` rings of the plot, optionally
 * filtered to one owner. Catches villages that no player's city list enumerates.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner filter (-1 = any).
 * @param {number} radius Rings to search.
 * @returns {boolean} True when a matching center is within radius.
 * @private
 */
function _centerOnMapWithin(plot, protectOwner, radius) {
  return safe(() => {
    const ring = plotsInRadius(plot, radius);
    const seen = ring.some((p) => p.x === plot.x && p.y === plot.y) ? ring : [plot, ...ring];
    for (const p of seen) {
      const owner = _mapCentreOwner(p);
      if (owner === null) continue;
      if (protectOwner >= 0 && owner !== protectOwner) continue;
      return true;
    }
    return false;
  }, false);
}

/**
 * Every living player's listed city centers, as plot key -> owner id (-1 when the player's id is unreadable).
 * @returns {Map<string, number>} Centers.
 * @private
 */
function _listedCentres() {
  /** @type {Map<string, number>} */
  const out = new Map();
  const alive = safe(() => Players?.getAlive?.(), null);
  if (!Array.isArray(alive)) return out;
  for (const player of alive) {
    if (!player || !player.isAlive) continue;
    const owner = typeof player.id === "number" ? player.id : -1;
    for (const city of safe(() => player.Cities?.getCities?.(), null) || []) {
      const loc = cityLoc(city);
      if (loc) out.set(`${loc.x},${loc.y}`, owner);
    }
  }
  return out;
}

/**
 * Whether any (optionally owner-filtered) listed city center sits within `radius` rings of the
 * plot. radius 0 = only the plot itself must be a center.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner filter (-1 = any).
 * @param {number} radius Rings to search.
 * @returns {boolean} True when a matching city center is within radius.
 * @private
 */
function _cityCenterWithin(plot, protectOwner, radius) {
  return safe(() => {
    const listed = _centres ? (_centres.listed ??= _listedCentres()) : _listedCentres();
    for (const p of [plot, ...plotsInRadius(plot, radius)]) {
      const owner = listed.get(`${p.x},${p.y}`);
      if (owner !== undefined && (protectOwner < 0 || owner === protectOwner)) return true;
    }
    return false;
  }, false);
}

/**
 * Resolve the at-war relationship across the differing Diplomacy shapes.
 * @param {*} dip Player a's Diplomacy component.
 * @param {number} b Player b's id.
 * @returns {boolean} True when at war.
 * @private
 */
function _dipAtWar(dip, b) {
  if (typeof dip.isAtWarWith === "function") return !!dip.isAtWarWith(b);
  const pb = Players?.get?.(b);
  if (pb && typeof dip.isAtWar === "function") return !!dip.isAtWar(pb.id ?? b);
  return false;
}

/**
 * Whether two players are at war (best-effort across Diplomacy shapes).
 * @param {number} a Player id.
 * @param {number} b Player id.
 * @returns {boolean} True when at war.
 */
export function atWar(a, b) {
  if (a < 0 || b < 0 || a === b) return false;
  return safe(() => {
    const dip = Players?.get?.(a)?.Diplomacy;
    return dip ? _dipAtWar(dip, b) : false;
  }, false);
}

/**
 * Whether a plot owned by another player may be taken at all: safety mode off, not a minor's land, no active war
 * with the owner (borders do not diffuse across a front), and outside that owner's protected city core.
 * Unowned plots never reach this test: the caller gates on `owner >= 0`.
 * @param {{x:number,y:number}} loc Target plot.
 * @param {number} owner Current owner player id.
 * @param {number} me Local player id.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {boolean} True when the rival-owned plot is claimable.
 */
export function rivalClaimAllowed(loc, owner, me, cfg) {
  if (cfg.claimOnlyUnowned) return false;          // safety mode: empty land only
  // A city-state's or independent's land never moves by culture. An independent's camp isn't a city center to the
  // engine (a WILDERNESS district with no city, watched 2026-10-24), so no ring around a center can shield it: a
  // ring rule let culture take the camp plot itself.
  if (isMinorOwner(owner)) return false;
  if (atWar(me, owner)) return false;              // no peaceful diffusion across an active front
  // Protect within coreProtectRadius rings of the owner's city center (0 = just the center plot, so
  // culture bites a major's ring-1+ inward; -1 = protect nothing).
  return !isCoreProtected(loc, owner, typeof cfg.coreProtectRadius === "number" ? cfg.coreProtectRadius : 1);
}

/**
 * Whether a player id belongs to a minor: a city-state or an Independent Power. Both read
 * `isMajor === false`; `isMinor` alone is false for Independent Powers (engine-closed.md).
 * @param {number} pid Player id.
 * @returns {boolean} True when the player is not a major civ.
 */
export function isMinorOwner(pid) {
  return safe(() => {
    const p = Players?.get?.(pid);
    return !!p && p.isMajor === false;
  }, false);
}

/**
 * Whether a player id belongs to a living major civilization: the only players that may gain land by culture or
 * conquest. `isMajor === true` is required (not merely "not minor"), and a dead player never qualifies.
 * @param {number} pid Player id.
 * @returns {boolean} True when the player is an alive major.
 */
export function isMajorPlayer(pid) {
  if (typeof pid !== "number" || pid < 0) return false;
  return safe(() => {
    const p = Players?.get?.(pid);
    return !!p && p.isMajor === true && p.isAlive !== false;
  }, false);
}

export { cityIdOf };
