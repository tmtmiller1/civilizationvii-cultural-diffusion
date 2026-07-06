// cd-ethnicity.js
//
// The ethnic-affinity layer (docs/cultural-diffusion-spec.md 3.1a term C): a frontier tile
// surrounded by a civ's diaspora feels that civ's pull even when its culture output is
// modest - borders follow people. This reads emigration's per-settlement population
// composition (via the import-free cd-emigration bridge) and turns it into an affinity
// closure the pass folds into pressure.
//
// STANDALONE-SAFE: if the fused model is off, emigration is disabled/absent, or no
// composition has been recorded yet, buildEthnicContext returns null -> the pass applies no
// ethnic multiplier (neutral x1). The mod never depends on emigration being installed.

import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";
import { loadComposition, shareOfCiv } from "/cultural-diffusion/ui/cd-emigration.js";

/**
 * Build the per-pass ethnic-affinity context. Attaches emigration's composition entries to
 * the current settlements by city-centre location, then answers, for any (civ, plot), the
 * diaspora share of that civ in the composition of the settlement NEAREST the plot - the
 * best available read of "whose people live around here."
 * @param {{loc:{x:number,y:number}}[]} settlements Settlement rows (need a `.loc`).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {{affinity:(owner:number, plot:{x:number,y:number})=>number}|null} Context, or null when unavailable.
 */
export function buildEthnicContext(settlements, cfg) {
  if (!cfg || !cfg.fusedModel || !cfg.useEmigration) return null;
  const comp = loadComposition();
  if (!comp) return null;

  /** @type {{loc:{x:number,y:number}, entry:{total:number, byCiv:Record<string,number>}}[]} */
  const nodes = [];
  for (const s of settlements) {
    const loc = s && s.loc;
    if (!loc) continue;
    const entry = comp.get(loc.x + "," + loc.y);
    if (entry) nodes.push({ loc, entry });
  }
  if (!nodes.length) return null;

  /** @type {Map<string, {total:number, byCiv:Record<string,number>}|null>} */
  const nearestCache = new Map();
  function nearestEntry(plot) {
    const k = plot.x + "," + plot.y;
    const hit = nearestCache.get(k);
    if (hit !== undefined) return hit;
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = hexDistance(n.loc, plot);
      if (d < bestD) { bestD = d; best = n.entry; }
    }
    nearestCache.set(k, best);
    return best;
  }

  return {
    affinity(owner, plot) {
      const entry = nearestEntry(plot);
      return entry ? shareOfCiv(entry, owner) : 0;
    }
  };
}
