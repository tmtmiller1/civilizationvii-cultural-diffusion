// cd-borders.js
//
// Border resistance reads (docs/current-model.md §5): a rival's city-core ring never flips, and an
// active war pauses peaceful diffusion across the front. Pure helpers (isCoreProtected) are
// unit-testable; the war read is engine-guarded.

import { plotsInRadius, cityLoc, cityIdOf, isCityCenterAt, ownerAt } from "/cultural-diffusion/ui/cd-plots.js";

/**
 * @param {()=>*} fn Thunk. @param {*} fallback Fallback. @returns {*} fn() or fallback.
 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * Whether a plot sits within `radius` rings of a protected city CENTER (the "downtown" shield that
 * never flips): radius 1 = center + ring-1; 0 = only the city-center plot; < 0 = nothing protected.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner id whose core to protect (-1 = protect every owner's core).
 * @param {number} [radius] Protection radius in rings (default 1).
 * @returns {boolean} True when the plot is core-protected.
 */
export function isCoreProtected(plot, protectOwner, radius = 1) {
  if (typeof radius === "number" && radius < 0) return false;
  const r = Math.max(0, radius || 0);
  // Two routes on purpose. The player-list route sees a major's or city-state's cities; the MAP route
  // also sees settlements no city list reports - watched: an Independent Power reads `cities: 0`, so
  // the list route alone leaves every village centre unprotected (docs/BACKLOG.md).
  return _cityCenterWithin(plot, protectOwner, r) || _centreOnMapWithin(plot, protectOwner, r);
}

/**
 * Whether a settlement centre read off the MAP sits within `radius` rings of the plot, optionally
 * filtered to one owner. Catches villages that no player's city list enumerates.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner filter (-1 = any).
 * @param {number} radius Rings to search.
 * @returns {boolean} True when a matching centre is within radius.
 * @private
 */
function _centreOnMapWithin(plot, protectOwner, radius) {
  return safe(() => {
    const ring = plotsInRadius(plot, radius);
    const seen = ring.some((p) => p.x === plot.x && p.y === plot.y) ? ring : [plot, ...ring];
    for (const p of seen) {
      if (!isCityCenterAt(p)) continue;
      if (protectOwner >= 0 && ownerAt(p) !== protectOwner) continue;
      return true;
    }
    return false;
  }, false);
}

/**
 * Whether any of `player`'s city centres sits on one of the pre-computed ring keys.
 * @param {*} player Engine player.
 * @param {number} protectOwner Owner filter (-1 = any).
 * @param {Set<string>} ringKeys Plot keys of the ring (plus the plot itself).
 * @returns {boolean} True when a matching city centre is on the ring.
 * @private
 */
function _playerCenterOnRing(player, protectOwner, ringKeys) {
  if (!player || !player.isAlive) return false;
  const owner = typeof player.id === "number" ? player.id : -1;
  if (protectOwner >= 0 && owner !== protectOwner) return false;
  const cities = safe(() => player.Cities?.getCities?.(), null);
  if (!cities) return false;
  for (const city of cities) {
    const loc = cityLoc(city);
    if (loc && ringKeys.has(`${loc.x},${loc.y}`)) return true;
  }
  return false;
}

/**
 * Whether any (optionally owner-filtered) city center sits within `radius` rings of the
 * plot. radius 0 = only the plot itself must be a center.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner filter (-1 = any).
 * @param {number} radius Rings to search.
 * @returns {boolean} True when a matching city center is within radius.
 * @private
 */
function _cityCenterWithin(plot, protectOwner, radius) {
  return safe(() => {
    const alive = Players?.getAlive?.();
    if (!Array.isArray(alive)) return false;
    const ring = plotsInRadius(plot, radius);
    const ringKeys = new Set(ring.map((p) => `${p.x},${p.y}`));
    ringKeys.add(`${plot.x},${plot.y}`);
    for (const player of alive) {
      if (_playerCenterOnRing(player, protectOwner, ringKeys)) return true;
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
 * Whether a plot owned by ANOTHER player may be taken at all: safety mode off, no active war with
 * the owner (borders do not diffuse across a front), and outside that owner's protected city core.
 * Unowned plots never reach this test - the caller gates on `owner >= 0`.
 * @param {{x:number,y:number}} loc Target plot.
 * @param {number} owner Current owner player id.
 * @param {number} me Local player id.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {boolean} True when the rival-owned plot is claimable.
 */
export function rivalClaimAllowed(loc, owner, me, cfg) {
  if (cfg.claimOnlyUnowned) return false;          // safety mode: empty land only
  if (atWar(me, owner)) return false;              // no peaceful diffusion across an active front
  // Protect within coreProtectRadius rings of the owner's city center (0 = just the center plot, so
  // culture bites a major's ring-1+ inward; -1 = protect nothing) - but a MINOR gets at least
  // minorProtectRadius, because its whole territory is that small.
  return !isCoreProtected(loc, owner, protectRadiusFor(owner, cfg));
}

/**
 * The core-protection radius to use against this owner: `coreProtectRadius`, raised to
 * `minorProtectRadius` when the owner is a minor (city-state or Independent Power). Fails toward the
 * plain radius when the player kind is unreadable.
 * @param {number} owner Owner player id.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Rings to protect.
 */
export function protectRadiusFor(owner, cfg) {
  const base = typeof cfg.coreProtectRadius === "number" ? cfg.coreProtectRadius : 1;
  const floor = typeof cfg.minorProtectRadius === "number" ? cfg.minorProtectRadius : -1;
  if (floor < 0 || !isMinorOwner(owner)) return base;
  return Math.max(base, floor);
}

/**
 * Whether a player id belongs to a MINOR: a city-state or an Independent Power. Both read
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

export { cityIdOf };
