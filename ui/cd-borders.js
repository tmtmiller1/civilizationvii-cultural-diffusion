// cd-borders.js
//
// Border resistance reads (docs/current-model.md §5): how strongly a
// plot resists flipping. Unowned land is cheapest; rival-owned land resists in
// proportion to the rival's own pressure; a rival's city-core ring never flips;
// and an active war pauses peaceful diffusion across the front.
//
// Pure helpers (isCoreProtected) are unit-testable; the war
// read is engine-guarded.

import { plotsInRadius, cityLoc, cityIdOf } from "/cultural-diffusion/ui/cd-plots.js";

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
 * Whether a plot sits within `radius` rings of a protected city CENTER - i.e. inside the
 * "downtown" shield that never flips. radius 1 = center + ring-1 (the classic downtown);
 * radius 0 = only the city-center plot itself (culture may bite ring-1 inward);
 * radius < 0 = nothing protected (even the center is flippable).
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner id whose core to protect (-1 = protect every owner's core).
 * @param {number} [radius] Protection radius in rings (default 1).
 * @returns {boolean} True when the plot is core-protected.
 */
export function isCoreProtected(plot, protectOwner, radius = 1) {
  if (typeof radius === "number" && radius < 0) return false;
  return _cityCenterWithin(plot, protectOwner, Math.max(0, radius || 0));
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

export { cityIdOf };
