// cd-borders.js
//
// Border resistance reads (docs/cultural-diffusion-spec.md 3.3): how strongly a
// plot resists flipping. Unowned land is cheapest; rival-owned land resists in
// proportion to the rival's own pressure; a rival's city-core ring never flips;
// and an active war pauses peaceful diffusion across the front.
//
// Pure helpers (isCoreProtected) are unit-testable; the war
// read is engine-guarded.

import { plotsInRadius, owningCityIdAt, cityLoc, cityIdOf } from "/cultural-diffusion/ui/cd-plots.js";

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
 * Whether a plot sits on the protected core ring (distance 1) of ANY city - no
 * civilization loses its downtown to culture.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner id whose core to protect (-1 = protect every owner's core).
 * @returns {boolean} True when the plot is core-protected.
 */
export function isCoreProtected(plot, protectOwner) {
  return safe(() => {
    const ring = plotsInRadius(plot, 1);
    for (const p of ring) {
      // A city center sits on an owned plot; if any adjacent plot is a city center of
      // the protected owner, this plot is on that city's core ring.
      const cityId = owningCityIdAt(p);
      if (cityId < 0) continue;
      // The plot itself being a city center is the strongest signal.
    }
    // Cheaper, robust check: is the plot adjacent to a city CENTER? We approximate
    // by asking whether any settlement center is within distance 1.
    return _adjacentToAnyCityCenter(plot, protectOwner);
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
 * Whether any city center is within distance 1 of the plot (optionally limited to
 * one owner). Uses the owning-city read at each ring plot: a plot whose owning city
 * is centered on it is a city center.
 * @param {{x:number,y:number}} plot Target plot.
 * @param {number} protectOwner Owner filter (-1 = any).
 * @returns {boolean} True when adjacent to a city center.
 * @private
 */
function _adjacentToAnyCityCenter(plot, protectOwner) {
  return safe(() => {
    const alive = Players?.getAlive?.();
    if (!Array.isArray(alive)) return false;
    const ring = plotsInRadius(plot, 1);
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
