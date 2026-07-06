// cd-pass.js
//
// The per-turn pass. Its reaction-diffusion core is adapted from the Civ V Cultural Diffusion
// model (spec 3b); the injection strength that drives it is this mod's own fused model (CPI +
// prosperity + per-civ tuning). Once per local-player turn, over a bounded region around the
// local player's cities, it:
//   1. INJECTS culture into each city tile (strength = fused CPI/prosperity projection),
//   2. DIFFUSES the persisted per-tile culture stock to neighbours (terrain- and diaspora-
//      modified, capped),
//   3. DECAYS every tile's stock,
//   4. FLIPS a tile to the local player once its culture there passes the ownership bar.
//
// Reach is therefore an EMERGENT, slow travelling wave - a mature culture's border creeps
// outward over tens of turns - not a closed-form distance calculation. Scope: the mod only
// ever mutates ownership FOR the local player (single-player), never a rival's core ring.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { dlog, log } from "/cultural-diffusion/ui/cd-log.js";
import {
  localPlayerId, mapDims, allSettlements, plotsInRadius, cityLoc, cityIdOf, ownerAt, isWater
} from "/cultural-diffusion/ui/cd-plots.js";
import { cultureOf, happinessOf, wonderCountOf, isCelebrating, currentAgeKey, prosperityOf, vitalityOf } from "/cultural-diffusion/ui/cd-polity.js";
import { projectionOf, hexDistance, ethnicFactor } from "/cultural-diffusion/ui/cd-pressure.js";
import { gatherCivMetrics } from "/cultural-diffusion/ui/cd-metrics.js";
import { powerMultipliers } from "/cultural-diffusion/ui/cd-cpi.js";
import { buildEthnicContext } from "/cultural-diffusion/ui/cd-ethnicity.js";
import { civTuning } from "/cultural-diffusion/ui/cd-civ-tuning.js";
import { agePace, mapSizeScale } from "/cultural-diffusion/ui/cd-calibration.js";
import { stepMods } from "/cultural-diffusion/ui/cd-terrain.js";
import { injectionAmount, cityCultureCap, decayValue, diffusionDelivered, resolveOwner } from "/cultural-diffusion/ui/cd-field.js";
import { isCoreProtected, atWar } from "/cultural-diffusion/ui/cd-borders.js";
import { performFlip } from "/cultural-diffusion/ui/cd-ownership.js";
import { loadState, saveState, prepareState, pruneState } from "/cultural-diffusion/ui/cd-state.js";
import { notifyFlip } from "/cultural-diffusion/ui/cd-notifications.js";

/** @param {number} x @param {number} y @returns {string} Plot key. */
function key(x, y) {
  return `${x},${y}`;
}

/** @param {string} k @returns {{x:number,y:number}} */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/**
 * Build the pressure-model Settlement rows from the live engine (once per pass).
 * @returns {import("/cultural-diffusion/ui/cd-pressure.js").Settlement[]} Settlements.
 */
function gatherSettlements() {
  const rows = allSettlements(false);
  const fused = !!CONFIG.fusedModel;
  /** @type {import("/cultural-diffusion/ui/cd-pressure.js").Settlement[]} */
  const out = [];
  for (const { city, owner } of rows) {
    const loc = cityLoc(city);
    if (!loc) continue;
    out.push({
      owner,
      loc,
      culture: cultureOf(city), // live per-turn culture (already age-appropriate; age scaling is applied to injection)
      happiness: happinessOf(city),
      wonders: wonderCountOf(city),
      celebrating: isCelebrating(owner),
      prosperity: fused ? prosperityOf(city) : 0,
      vitality: fused ? vitalityOf(city) : 0 // aggregate blended with culture in the fused injection base
    });
  }
  return out;
}

/**
 * The local player's own cities (as {city, id, loc}).
 * @returns {{city:*, id:number, loc:{x:number,y:number}}[]} Cities.
 */
function localCityList() {
  const me = localPlayerId();
  const rows = allSettlements(false).filter((r) => r.owner === me);
  /** @type {{city:*, id:number, loc:{x:number,y:number}}[]} */
  const out = [];
  for (const { city } of rows) {
    const loc = cityLoc(city);
    if (loc) out.push({ city, id: cityIdOf(city), loc });
  }
  return out;
}

/**
 * The nearest local-player city to a plot (for attachment + distance checks).
 * @param {{x:number,y:number}} plot Plot.
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities Local cities.
 * @returns {{city:*, id:number, loc:{x:number,y:number}, d:number}|null} Nearest city + distance.
 */
function nearestCity(plot, cities) {
  let best = null;
  let bestD = Infinity;
  for (const c of cities) {
    const d = hexDistance(c.loc, plot);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { ...best, d: bestD } : null;
}

/** The set of player ids that currently have living settlements (+ the local player). */
function aliveOwners(me) {
  const set = new Set();
  if (me >= 0) set.add(me);
  for (const r of allSettlements(true)) set.add(r.owner);
  return set;
}

/** True when any neighbour of the plot is owned by `me` (Civ V IsAdjacentToOwner). */
function adjacentToMe(plot, me) {
  for (const n of plotsInRadius(plot, 1)) {
    if (n.x === plot.x && n.y === plot.y) continue;
    if (ownerAt(n) === me) return true;
  }
  return false;
}

/**
 * The bounded simulation region: every non-water in-bounds tile within `radius` of a local city.
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities Local cities.
 * @param {number} radius Field radius.
 * @param {(p:{x:number,y:number})=>boolean} inBounds Bounds test.
 * @returns {Set<string>} Region plot keys.
 */
function buildRegion(cities, radius, inBounds) {
  /** @type {Set<string>} */
  const region = new Set();
  for (const c of cities) {
    for (const p of plotsInRadius(c.loc, radius)) {
      if (inBounds(p) && !isWater(p)) region.add(key(p.x, p.y));
    }
  }
  return region;
}

/**
 * Per-age injection scaling + a time-re-paced copy of CONFIG. Diffusion/decay scale together, so
 * the reach EXTENT is unchanged and only the SPEED of approach is re-timed (3c/3d).
 * @returns {{ageInject:number, pace:number, ageCfg:import("/cultural-diffusion/ui/cd-config.js").CdConfig}}
 */
function ageContext() {
  const ageKey = currentAgeKey();
  const age = (CONFIG.byAge && CONFIG.byAge[ageKey]) || { injectionScale: 1, ownerBar: 1 };
  const pace = agePace();
  const mapScale = mapSizeScale();
  const ageInject = Math.max(0, age.injectionScale != null ? age.injectionScale : 1) * mapScale;
  const ageCfg = {
    ...CONFIG,
    minimumOwner: CONFIG.minimumOwner * Math.max(0.1, age.ownerBar != null ? age.ownerBar : 1),
    diffusionRate: CONFIG.diffusionRate * pace,
    decayRate: CONFIG.decayRate * pace,
    decayFlat: CONFIG.decayFlat * pace
  };
  return { ageInject, pace, ageCfg };
}

/**
 * Fused per-civ injection-strength function (CPI power x per-age damping x civ variance) plus the
 * optional ethnic-diffusion context. When fusedModel is off, strength is the raw projection.
 * @param {import("/cultural-diffusion/ui/cd-pressure.js").Settlement[]} settlements Settlements.
 * @param {number} ageInject Per-age injection scale.
 * @returns {{strengthOf:(s:*)=>number, ethCtx:*}} Strength fn + ethnic context (or null).
 */
function injectionModel(settlements, ageInject) {
  /** @type {Map<number, number>|null} */
  let powerMult = null;
  let ethCtx = null;
  if (CONFIG.fusedModel) {
    const raw = gatherCivMetrics();
    if (raw && raw.size) powerMult = powerMultipliers(raw, CONFIG).power;
    ethCtx = buildEthnicContext(settlements, CONFIG);
  }
  const strengthOf = (s) =>
    projectionOf(s, CONFIG)
    * (powerMult ? (powerMult.get(s.owner) || 1) : 1)
    * ageInject
    * civTuning(s.owner).injectionScale;
  return { strengthOf, ethCtx };
}

/** Decay every region tile that currently holds culture into `next` (field step 1). */
function decayStep(field, region, next, rowOf, ageCfg) {
  for (const k of Object.keys(field)) {
    if (!region.has(k)) continue;
    const src = field[k];
    const dst = rowOf(k);
    for (const civ of Object.keys(src)) {
      const v = decayValue(src[civ], ageCfg);
      if (v > 0) dst[civ] = v;
    }
  }
}

/**
 * Deliver diffusion from one source tile/civ to a single in-region neighbour, applying terrain
 * step-mods and (when present) the diaspora affinity accelerant.
 */
function diffuseToNeighbour(src, nb, ctx) {
  const { loc: srcLoc, val: srcVal, civ, civId } = src;
  const { region, rowOf, ethCtx, ageCfg } = ctx;
  if (nb.x === srcLoc.x && nb.y === srcLoc.y) return;
  const nk = key(nb.x, nb.y);
  if (!region.has(nk)) return;
  const mods = stepMods(srcLoc, nb, srcVal, CONFIG);
  if (ethCtx && !mods.blocked) {
    const aff = ethCtx.affinity(civId, nb);
    if (aff > 0) mods.bonus += ethnicFactor(aff, CONFIG.ethnicWeight) - 1; // diaspora accelerates the front
  }
  const dstRow = rowOf(nk);
  const add = diffusionDelivered(srcVal, dstRow[civ] || 0, mods, ageCfg);
  if (add > 0) dstRow[civ] = (dstRow[civ] || 0) + add;
}

/**
 * Diffuse from every above-threshold source tile to its in-region neighbours (field step 2),
 * applying terrain step-mods and (when present) the diaspora affinity accelerant.
 */
function diffuseStep(ctx) {
  const { field, region, threshold } = ctx;
  for (const k of Object.keys(field)) {
    if (!region.has(k)) continue;
    const src = field[k];
    const srcLoc = unkey(k);
    for (const civ of Object.keys(src)) {
      const srcVal = src[civ];
      if (srcVal <= threshold) continue;
      const source = { loc: srcLoc, val: srcVal, civ, civId: parseInt(civ, 10) };
      for (const nb of plotsInRadius(srcLoc, 1)) {
        diffuseToNeighbour(source, nb, ctx);
      }
    }
  }
}

/** Inject each city's culture into its own tile, capped (field step 3). */
function injectStep(injectors, field, rowOf, pace) {
  for (const [k, inj] of injectors) {
    const civ = String(inj.civ);
    const row = rowOf(k);
    const currentOwn = (field[k] && field[k][civ]) || 0;
    const cap = cityCultureCap(inj.strength, CONFIG);
    if (currentOwn < cap) {
      // pace scales the per-turn injected amount too (cap itself is unpaced), so the city stock
      // builds toward the same equilibrium, just re-timed to the age length.
      const add = Math.min(cap - currentOwn, injectionAmount(inj.strength, currentOwn, CONFIG) * pace);
      if (add > 0) row[civ] = (row[civ] || 0) + add;
    } else if (!(row[civ] > 0)) {
      row[civ] = currentOwn;
    }
  }
}

/**
 * Run the synchronous field update (decay + diffuse + inject + carry-over) and commit it to
 * `state.field`. Returns the new field so ownership resolution can read it directly.
 */
function updateField(state, region, injectors, ctx) {
  const { threshold, ethCtx, ageCfg, pace } = ctx;
  const field = state.field;
  /** @type {Record<string, Record<string, number>>} */
  const next = {};
  const rowOf = (k) => (next[k] || (next[k] = {}));
  decayStep(field, region, next, rowOf, ageCfg);
  diffuseStep({ field, region, next, rowOf, threshold, ethCtx, ageCfg });
  injectStep(injectors, field, rowOf, pace);
  for (const k of Object.keys(field)) if (!region.has(k)) next[k] = field[k]; // carry over out-of-region
  state.field = next;
  return next;
}

/** Owner ids referenced in the region field that no longer have living settlements. */
function findDeadOwners(region, next, alive) {
  const deadOwners = [];
  for (const k of region) {
    const row = next[k];
    if (!row) continue;
    for (const civ of Object.keys(row)) {
      const pid = parseInt(civ, 10);
      if (!alive.has(pid) && deadOwners.indexOf(pid) < 0) deadOwners.push(pid);
    }
  }
  return deadOwners;
}

/** Current per-city claim counts for the local player (enforces maxDiffusionPlots). */
function claimCountsFor(state, me) {
  /** @type {Map<number, number>} */
  const claimCount = new Map();
  for (const c of Object.values(state.claims)) {
    if (c && c.by === me) claimCount.set(c.city, (claimCount.get(c.city) || 0) + 1);
  }
  return claimCount;
}

/** Flip candidates (nearest local city within flipMaxDistance), sorted nearest-first. */
function flipCandidates(region, next, cities, maxDist) {
  const candidates = [];
  for (const k of region) {
    if (!next[k]) continue;
    const loc = unkey(k);
    const near = nearestCity(loc, cities);
    if (!near || near.d > maxDist) continue;
    candidates.push({ k, loc, near });
  }
  candidates.sort((a, b) => a.near.d - b.near.d);
  return candidates;
}

/**
 * Whether a won tile passes every eligibility gate (safety mode, war, core protection,
 * adjacency, per-city cap). Kept as pure predicates so the flip loop stays flat.
 */
function flipEligible(cand, owner, me, claimCount) {
  const { k, loc, near } = cand;
  if (owner >= 0) {
    if (CONFIG.claimOnlyUnowned) return false;          // safety mode: empty land only
    if (atWar(me, owner)) return false;                 // no peaceful diffusion across an active front
    if (CONFIG.cityCoreProtection && isCoreProtected(loc, owner)) return false; // never a rival downtown
  }
  if (!adjacentToMe(loc, me)) return false;             // must touch our existing land (Civ V rule)
  if ((claimCount.get(near.id) || 0) >= Math.max(0, CONFIG.maxDiffusionPlots)) {
    dlog(`skip flip ${k}: city ${near.id} at maxDiffusionPlots`);
    return false;
  }
  return true;
}

/** Commit a single won+eligible flip, recording claim/lock bookkeeping and a seed stock. */
function commitFlip(cand, owner, verdict, fx) {
  const { state, next, me, ageCfg, claimCount } = fx;
  const { k, loc, near } = cand;
  const res = performFlip({ playerId: me, city: near.city, loc, verb: CONFIG.flipVerb });
  if (!res.ok) {
    dlog(`flip ${k} FAILED reason=${res.reason} verb=${res.verb}`);
    return false;
  }
  claimCount.set(near.id, (claimCount.get(near.id) || 0) + 1);
  state.claims[k] = { by: me, city: near.id, turn: state.monoTurn };
  state.locked[k] = Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
  // seed a stable stock so the tile doesn't immediately fail the ownership test
  next[k][String(me)] = Math.max(next[k][String(me)] || 0, ageCfg.minimumOwner);
  dlog(`flip ${k} -> player ${me} via ${res.verb} (was owner ${owner}, culture ${Math.round(verdict.value)})`);
  notifyFlip({ x: loc.x, y: loc.y, wasOwner: owner, newOwner: me });
  return true;
}

/** Resolve a single candidate tile: gate, then flip. Returns true when a flip was committed. */
function tryFlipCandidate(cand, fx) {
  const { state, next, me, ageCfg, claimCount, deadOwners } = fx;
  const owner = ownerAt(cand.loc);
  if (owner === me) return false;                       // already ours
  if (state.locked[cand.k] > 0) return false;           // anti-flicker cooldown
  const verdict = resolveOwner(next[cand.k], owner, deadOwners, ageCfg);
  if (!verdict.flip || verdict.owner !== me) return false; // only claim tiles OUR culture has won
  if (!flipEligible(cand, owner, me, claimCount)) return false;
  return commitFlip(cand, owner, verdict, fx);
}

/**
 * Ownership resolution: flip in-region tiles to the LOCAL player only, nearest-first, honouring
 * every eligibility gate and per-turn/per-city caps.
 * @param {{state:*, region:Set<string>, next:*, cities:*, me:number, ageCfg:*}} p Pass state.
 * @returns {{flips:number, tiles:number}} Flip summary.
 */
function resolveOwnership({ state, region, next, cities, me, ageCfg }) {
  const alive = aliveOwners(me);
  const deadOwners = findDeadOwners(region, next, alive);
  const claimCount = claimCountsFor(state, me);
  const maxFlips = Math.max(0, CONFIG.maxFlipsPerTurn);
  const maxDist = Math.max(1, CONFIG.flipMaxDistance);
  const candidates = flipCandidates(region, next, cities, maxDist);
  const fx = { state, next, me, ageCfg, claimCount, deadOwners };

  let flips = 0;
  let tiles = 0;
  for (const cand of candidates) {
    if (flips >= maxFlips) break;
    tiles++;
    if (tryFlipCandidate(cand, fx)) flips++;
  }
  return { flips, tiles };
}

/** Prune far/empty field tiles to bound persisted size (keeps a 2-tile skirt past the region). */
function pruneFarField(state, region, cities, radius) {
  for (const k of Object.keys(state.field)) {
    if (region.has(k)) continue;
    const loc = unkey(k);
    const near = nearestCity(loc, cities);
    if (!near || near.d > radius + 2) delete state.field[k];
  }
}

/**
 * Injectors: any settlement whose centre sits in the region (nearby rivals inject too, so their
 * culture contests the field). Map cityKey -> { civ, strength }.
 * @param {import("/cultural-diffusion/ui/cd-pressure.js").Settlement[]} settlements Settlements.
 * @param {Set<string>} region Region plot keys.
 * @param {(s:*)=>number} strengthOf Injection-strength function.
 * @returns {Map<string, {civ:number, strength:number}>} Injectors by plot key.
 */
function buildInjectors(settlements, region, strengthOf) {
  /** @type {Map<string, {civ:number, strength:number}>} */
  const injectors = new Map();
  for (const s of settlements) {
    const k = key(s.loc.x, s.loc.y);
    if (region.has(k)) injectors.set(k, { civ: s.owner, strength: strengthOf(s) });
  }
  return injectors;
}

/**
 * Prepare everything a pass needs before the field update: loaded state, the bounded region, the
 * per-age config/pace, and the region injectors. Keeps runPass at a readable statement count.
 * @returns {{state:*, region:Set<string>, radius:number, injectors:Map<string,*>, threshold:number,
 *   ethCtx:*, ageCfg:*, pace:number}} Prepared pass context.
 */
function preparePass(cities) {
  const state = loadState();
  prepareState(state);

  const { w, h } = mapDims();
  const inBounds = (p) => (!w || (p.x >= 0 && p.x < w)) && (!h || (p.y >= 0 && p.y < h));
  const radius = Math.max(2, CONFIG.fieldRadius);
  const region = buildRegion(cities, radius, inBounds);

  const { ageInject, pace, ageCfg } = ageContext();
  const settlements = gatherSettlements();
  const { strengthOf, ethCtx } = injectionModel(settlements, ageInject);
  const injectors = buildInjectors(settlements, region, strengthOf);
  const threshold = Math.max(0, CONFIG.cultureThreshold);
  return { state, region, radius, injectors, threshold, ethCtx, ageCfg, pace };
}

/**
 * Run one reaction-diffusion pass. Idempotent-safe: bails cleanly when disabled, in
 * multiplayer, or with no local cities.
 * @returns {{flips:number, tiles:number}} Pass summary.
 */
export function runPass() {
  if (!CONFIG.diffusionEnabled) return { flips: 0, tiles: 0 };
  const me = localPlayerId();
  if (me < 0) return { flips: 0, tiles: 0 };
  const cities = localCityList();
  if (!cities.length) return { flips: 0, tiles: 0 };

  const { state, region, radius, injectors, threshold, ethCtx, ageCfg, pace } = preparePass(cities);
  const next = updateField(state, region, injectors, { threshold, ethCtx, ageCfg, pace });
  const { flips, tiles } = resolveOwnership({ state, region, next, cities, me, ageCfg });

  pruneFarField(state, region, cities, radius);
  pruneState(state);
  saveState(state);
  if (flips > 0 || CONFIG.debug) log(`pass: ${flips} flip(s), ${Object.keys(state.field).length} active field tile(s)`);
  return { flips, tiles };
}

/** Test/introspection helpers (pure). */
export const __test = { nearestCity, adjacentToMe };
