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
  localPlayerId, mapDims, allSettlements, plotsInRadius, cityLoc, cityIdOf,
  ownerAt, owningCityIdAt, isWater, isDistantLands
} from "/cultural-diffusion/ui/cd-plots.js";
import { cultureOf, happinessOf, wonderCountOf, isCelebrating, currentAgeKey, prosperityOf, vitalityOf } from "/cultural-diffusion/ui/cd-polity.js";
import { projectionOf, hexDistance, ethnicFactor } from "/cultural-diffusion/ui/cd-pressure.js";
import { gatherCivMetrics } from "/cultural-diffusion/ui/cd-metrics.js";
import { powerMultipliers } from "/cultural-diffusion/ui/cd-cpi.js";
import { buildEthnicContext } from "/cultural-diffusion/ui/cd-ethnicity.js";
import { civTuning } from "/cultural-diffusion/ui/cd-civ-tuning.js";
import { agePace, mapSizeScale, ageProgress } from "/cultural-diffusion/ui/cd-calibration.js";
import { stepMods } from "/cultural-diffusion/ui/cd-terrain.js";
import { injectionAmount, cityCultureCap, decayValue, diffusionDelivered, resolveOwner } from "/cultural-diffusion/ui/cd-field.js";
import { isCoreProtected, atWar } from "/cultural-diffusion/ui/cd-borders.js";
import { performFlip, unclaim } from "/cultural-diffusion/ui/cd-ownership.js";
import { loadState, saveState, prepareState, pruneState } from "/cultural-diffusion/ui/cd-state.js";
import { notifyFlip } from "/cultural-diffusion/ui/cd-notifications.js";
import { recedeOwnership } from "/cultural-diffusion/ui/cd-recede.js";
import { logFieldDiagnostics, logStateSize } from "/cultural-diffusion/ui/cd-diagnostics.js";
import { markPending, isPending, confirmPending } from "/cultural-diffusion/ui/cd-pending.js";

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

/**
 * True when a plot lies within any LOCAL city's base-game natural growth ring (baseGrowthRadius).
 * These inner rings belong ENTIRELY to the base game, which assigns each tile to the city that can
 * actually WORK it. The mod must never own or reassign them: force-buying an inner tile to the
 * geometrically nearest city (which may not be the city whose ring it sits in, or may be too far to
 * work it) leaves the tile owned-but-unworkable - the "can't work some tiles in my 3-ring"
 * regression. The mod only ever claims the FRONTIER beyond this ring (the anti-forward-settle buffer).
 * @param {{x:number,y:number}} loc Plot.
 * @param {{city:*, id:number, loc:{x:number,y:number}}[]} cities Local cities.
 * @returns {boolean} True when the base game, not the mod, should own this tile.
 */
function withinOwnNaturalRing(loc, cities) {
  const r = Math.max(1, Math.floor(CONFIG.baseGrowthRadius));
  for (const c of cities) if (hexDistance(c.loc, loc) <= r) return true;
  return false;
}

/** The set of player ids that currently have living settlements (+ the local player). */
function aliveOwners(me) {
  const set = new Set();
  if (me >= 0) set.add(me);
  for (const r of allSettlements(true)) set.add(r.owner);
  return set;
}

/**
 * True when claiming this plot is forbidden because it is in the local player's DISTANT LANDS and
 * we are still before the Exploration age. Culture may reach home-hemisphere islands across nearby
 * water anytime, but the far hemisphere is off-limits until Exploration (base-game ocean gating).
 */
function distantLandsGated(loc, me) {
  if (!CONFIG.blockDistantLandsBeforeExploration) return false;
  if (currentAgeKey() !== "ANTIQUITY") return false; // Exploration+ may claim distant lands
  return isDistantLands(me, loc);
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
      // Water is in the region only when culture is allowed to cross it; otherwise land-only.
      if (inBounds(p) && (CONFIG.diffuseAcrossWater || !isWater(p))) region.add(key(p.x, p.y));
    }
  }
  return region;
}

const AGE_ORDER = ["ANTIQUITY", "EXPLORATION", "MODERN"];

/** The configured waterEase anchor for an age (0 when unset). */
function ageWaterEase(ageKey) {
  const a = CONFIG.byAge && CONFIG.byAge[ageKey];
  return a && a.waterEase != null ? a.waterEase : 0;
}

/**
 * The waterEase to use right now: this age's anchor, optionally ramped CONTINUOUSLY toward the
 * NEXT age's anchor by progress through the current age (Game.turn / Game.maxTurns). So water
 * crossing improves smoothly across an age instead of stepping at the boundary.
 * @param {string} ageKey Current age key.
 * @returns {number} Effective waterEase in [0,1].
 */
function effectiveWaterEase(ageKey) {
  const cur = ageWaterEase(ageKey);
  if (!CONFIG.waterEaseRamp) return cur;
  const idx = AGE_ORDER.indexOf(ageKey);
  const nextKey = (idx >= 0 && idx < AGE_ORDER.length - 1) ? AGE_ORDER[idx + 1] : ageKey;
  const nxt = ageWaterEase(nextKey);
  const t = Math.min(1, Math.max(0, ageProgress()));
  return cur + (nxt - cur) * t;
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
  const waterEase = effectiveWaterEase(ageKey);
  const ageCfg = {
    ...CONFIG,
    minimumOwner: CONFIG.minimumOwner * Math.max(0.1, age.ownerBar != null ? age.ownerBar : 1),
    diffusionRate: CONFIG.diffusionRate * pace,
    decayRate: CONFIG.decayRate * pace,
    decayFlat: CONFIG.decayFlat * pace,
    // Water crossing eases as sea travel matures (0 = full malus, 1 = no water penalty).
    terrainCoast: easeCrossing(CONFIG.terrainCoast, waterEase),
    terrainOcean: easeCrossing(CONFIG.terrainOcean, waterEase)
  };
  return { ageInject, pace, ageCfg };
}

/**
 * Ease a water crossing modifier toward "free" by `ease` in [0,1]: 0 returns the modifier
 * unchanged (full malus), 1 returns {malus:0, max:1, threshold:0} (no water penalty at all).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CrossMod} m Base crossing modifier.
 * @param {number} ease Easing fraction.
 * @returns {import("/cultural-diffusion/ui/cd-config.js").CrossMod} Eased modifier.
 */
function easeCrossing(m, ease) {
  const e = Math.max(0, Math.min(1, ease));
  if (!m) return m;
  return {
    malus: m.malus * (1 - e),
    max: m.max + (1 - m.max) * e,   // toward 1.0 = no neighbour-cap reduction
    threshold: m.threshold * (1 - e) // toward 0 = culture crosses at any strength
  };
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
  const mods = stepMods(srcLoc, nb, srcVal, ageCfg); // ageCfg carries the per-age water easing
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
  const bump = (city) => claimCount.set(city, (claimCount.get(city) || 0) + 1);
  for (const c of Object.values(state.claims)) {
    if (c && c.by === me) bump(c.city);
  }
  // A claim still landing (cd-pending.js) spends the budget too, so a city can't over-claim mid-write.
  for (const p of Object.values(state.pending || {})) {
    if (p && p.kind === "claim" && p.by === me) bump(p.city);
  }
  return claimCount;
}

/** Flip candidates (nearest local city within flipMaxDistance), sorted nearest-first. */
function flipCandidates(region, next, cities, maxDist) {
  const candidates = [];
  for (const k of region) {
    if (!next[k]) continue;
    const loc = unkey(k);
    if (withinOwnNaturalRing(loc, cities)) continue; // base game owns/works your inner rings - never claim them
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
  if (distantLandsGated(loc, me)) return false;         // no distant-lands claims before Exploration
  if (owner >= 0) {
    if (CONFIG.claimOnlyUnowned) return false;          // safety mode: empty land only
    if (atWar(me, owner)) return false;                 // no peaceful diffusion across an active front
    // Protect only within coreProtectRadius rings of the rival's city center (0 = just the
    // center plot, so culture bites their ring-1+ inward; -1 = protect nothing).
    if (isCoreProtected(loc, owner, CONFIG.coreProtectRadius)) return false;
  }
  // The organic contiguous front: only flip a tile touching our land, so a rival's rings are
  // taken from the outside in. Off = flip any tile our culture field dominates (enclaves ok).
  if (CONFIG.requireAdjacency && !adjacentToMe(loc, me)) return false;
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
  const res = performFlip({ playerId: me, city: near.city, loc, verb: CONFIG.flipVerb, refund: CONFIG.refundGold });
  // Guard: verify the tile actually changed owner before recording anything. performFlip only
  // reports "didn't throw", but a claim can silently no-op (e.g. purchasePlot fails, or the
  // legacy setOwnership verb no-ops on rival land - probe-history.md §2: 102/102
  // no-change). Without this check every silent no-op was booked as a win — consuming the city's
  // maxDiffusionPlots budget, locking the tile for flipCooldownTurns, seeding a phantom stock,
  // and firing a false "claimed territory" toast. The default integrated verb (purchasePlot)
  // now attaches the tile to near.city, so a real owner change here also means an integrated,
  // workable plot — no orphan, and no conflict with the base game's own border growth.
  if (!res.ok) {
    dlog(`flip ${k} NOT APPLIED reason=${res.reason || "call-failed"} verb=${res.verb}`);
    return false;
  }
  if (ownerAt(loc) !== me) {
    // The engine applies ownership AFTER the call (watched in-game on 1.4.2, devtools/harness run 1), so the
    // same-tick read is still the old owner. Book it next pass from the live map (cd-pending.js); it counts
    // toward the per-city budget and the per-turn cap now, so a runaway can't happen while writes are in flight.
    markPending(state, k, { kind: "claim", by: me, city: near.id, was: owner });
    claimCount.set(near.id, (claimCount.get(near.id) || 0) + 1);
    dlog(`flip ${k} -> player ${me} via ${res.verb} sent; pending confirmation next pass (was owner ${owner})`);
    return "pending";
  }
  claimCount.set(near.id, (claimCount.get(near.id) || 0) + 1);
  state.claims[k] = { by: me, city: near.id, turn: state.monoTurn };
  state.locked[k] = Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
  // seed a stable stock so the tile doesn't immediately fail the ownership test
  next[k][String(me)] = Math.max(next[k][String(me)] || 0, ageCfg.minimumOwner);
  dlog(`flip ${k} -> player ${me} via ${res.verb} (was owner ${owner}, culture ${Math.round(verdict.value)})`);
  notifyFlip({ x: loc.x, y: loc.y, wasOwner: owner, newOwner: me });
  return "booked";
}

/** Resolve a single candidate tile: gate, then flip. Returns true when a flip was committed. */
function tryFlipCandidate(cand, fx) {
  const { state, next, me, ageCfg, claimCount, deadOwners } = fx;
  const owner = ownerAt(cand.loc);
  if (owner === me) return false;                       // already ours
  if (state.locked[cand.k] > 0) return false;           // anti-flicker cooldown
  if (isPending(state, cand.k)) return false;           // a verb on this tile is still landing
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
  let pending = 0;
  let tiles = 0;
  for (const cand of candidates) {
    if (flips + pending >= maxFlips) break;
    tiles++;
    const result = tryFlipCandidate(cand, fx);
    if (result === "booked") flips++;
    else if (result === "pending") pending++;
  }
  return { flips, pending, tiles, deadOwners };
}

/** Commit one buffer claim (integrated verb + claim/lock/seed bookkeeping). @returns {boolean} */
function commitBuffer(state, c, T, me) {
  const res = performFlip({ playerId: me, city: c.city, loc: T, verb: CONFIG.flipVerb, refund: CONFIG.refundGold });
  const k = key(T.x, T.y);
  if (!res.ok) {
    dlog(`buffer ${k} NOT APPLIED reason=${res.reason || "call-failed"}`);
    return false;
  }
  if (ownerAt(T) !== me) {
    markPending(state, k, { kind: "claim", by: me, city: c.id, was: -1 }); // lands after the call; next pass books it
    dlog(`buffer ${k} sent; pending confirmation next pass`);
    return true;
  }
  state.claims[k] = { by: me, city: c.id, turn: state.monoTurn };
  state.locked[k] = Math.max(0, Math.floor(CONFIG.flipCooldownTurns));
  if (!state.field[k]) state.field[k] = {};
  state.field[k][String(me)] = Math.max(state.field[k][String(me)] || 0, CONFIG.minimumOwner);
  notifyFlip({ x: T.x, y: T.y, wasOwner: -1, newOwner: me });
  return true;
}

/**
 * Event-driven "+1 ring" cultural buffer. Called when the LOCAL player completes a rural
 * improvement on `devLoc` (a manual rural-growth event): claim only the UNOWNED land tiles
 * ADJACENT to that developed tile (not the whole ring) for the nearest city, via the integrated
 * verb. So developing a frontier tile pushes your cultural border one tile past it - organically,
 * paced to your own development. Only ever takes UNOWNED land; it never takes another player's
 * tile (peaceful rival capture stays with the slow diffusion pass). A +1 cap (baseGrowthRadius+1
 * rings from the nearest city centre) keeps the buffer from creeping past a single ring.
 * @param {{x:number,y:number}} devLoc The just-developed tile.
 * @returns {number} Buffer tiles claimed.
 */
export function claimBufferAt(devLoc) {
  if (!CONFIG.growthBuffer) return 0;
  const me = localPlayerId();
  if (me < 0 || ownerAt(devLoc) !== me) return 0;   // only OUR own development
  const cities = localCityList();
  if (!cities.length) return 0;
  const ctx = { me, cities, maxR: Math.max(1, Math.floor(CONFIG.baseGrowthRadius)) + 1 };
  const state = loadState();
  let claimed = 0;
  for (const n of plotsInRadius(devLoc, 1)) {
    const nc = bufferTarget(n, devLoc, state, ctx);
    if (nc && commitBuffer(state, nc, n, me)) claimed++;
  }
  if (claimed > 0) {
    saveState(state);
    log(`buffer: +${claimed} tile(s) adjacent to rural growth at ${devLoc.x},${devLoc.y}`);
  }
  return claimed;
}

/**
 * The nearest local city an UNOWNED neighbour tile should attach to as a +1 buffer, or null when
 * ineligible (the dev tile itself, already-owned, cooldown-locked, or past the +1 ring cap). Unlike
 * the land-only diffusion field, the buffer claims adjacent UNOWNED water too (coastal borders).
 */
function bufferTarget(n, devLoc, state, ctx) {
  if (n.x === devLoc.x && n.y === devLoc.y) return null;
  if (ownerAt(n) >= 0) return null;                 // UNOWNED only - never take a tile another player owns
  if (state.locked[key(n.x, n.y)] > 0) return null; // anti-flicker cooldown
  if (isPending(state, key(n.x, n.y))) return null; // a verb on this tile is still landing
  if (distantLandsGated(n, ctx.me)) return null;    // no distant-lands claims before Exploration
  if (withinOwnNaturalRing(n, ctx.cities)) return null; // base game owns inner rings; buffer only BEYOND them
  const nc = nearestCity(n, ctx.cities);
  return (nc && nc.d <= ctx.maxR) ? nc : null;
}

/**
 * Heal ORPHAN tiles - a tile owned by the local player but attached to NO city (owner === me,
 * owningCity < 0). Orphans are produced by the legacy setOwnership verb (older builds, or a
 * pre-fix save): they are not workable AND they block the base game's own population/border
 * growth from ever acquiring that tile - the "inner ring won't expand" bug. For each orphan in
 * the region we RELEASE it (unclaim), then re-acquire it through the integrated verb so it
 * becomes a real city tile that base-game growth flows around normally; if the re-buy doesn't
 * take, the tile stays released so the base game can simply grow into it. Idempotent: once a
 * tile is integrated (or released) it is no longer an orphan, so later passes find nothing.
 * @returns {number} Orphan tiles healed this pass.
 */
function repairOrphans(state, region, cities, me) {
  if (!CONFIG.repairOrphans) return 0;
  let healed = 0;
  for (const k of region) {
    const loc = unkey(k);
    if (ownerAt(loc) !== me) continue;       // only our own tiles
    if (owningCityIdAt(loc) >= 0) continue;  // already a real city tile - not an orphan
    // An orphan inside our own natural ring goes BACK to the base game, not re-bought to the nearest
    // city: re-buying attaches it to whichever city center is closest, which may not be the city
    // whose ring it sits in (or may be too far to work it) - the "can't work some inner tiles"
    // regression. Releasing it lets the base game re-acquire it and assign it to the city that works it.
    if (withinOwnNaturalRing(loc, cities)) {
      unclaim(loc);
      forgetClaim(state, k);
      healed++;
    } else if (reintegrateOrphan(state, k, loc, cities, me)) {
      healed++;
    }
  }
  return healed;
}

/** Drop a tile's claim + lock bookkeeping (used when a tile is handed back to the base game). */
function forgetClaim(state, k) {
  delete state.claims[k];
  delete state.locked[k];
}

/**
 * Re-integrate a FRONTIER orphan (beyond the base-game natural ring) into its nearest city: release
 * it, then re-buy via the integrated verb (purchasePlot is proven on UNOWNED land, so releasing
 * makes the re-claim take the proven path). On failure the tile stays released so the base game can
 * grow into it. @returns {boolean} True when the orphan was processed (false = no city to attach to).
 */
function reintegrateOrphan(state, k, loc, cities, me) {
  const near = nearestCity(loc, cities);
  if (!near) return false;
  unclaim(loc);
  const res = performFlip({ playerId: me, city: near.city, loc, verb: "purchasePlot", refund: CONFIG.refundGold });
  if (res.ok && ownerAt(loc) === me) {
    state.claims[k] = { by: me, city: near.id, turn: state.monoTurn };
  } else {
    forgetClaim(state, k);
    dlog(`repair ${k}: released orphan (re-integrate failed reason=${res.reason})`);
  }
  return true;
}

/**
 * Release any MOD-CLAIMED tile that sits within a local city's base-game natural ring back to the
 * base game, so it re-acquires the tile and assigns it to the city that can actually WORK it. Heals
 * saves already damaged by the 1.0.6 build, where inner-ring tiles were force-bought to the
 * geometrically nearest city (often the wrong one), leaving them owned-but-unworkable. Unlike
 * repairOrphans (which only sees owner-me/no-owning-city orphans), this reconciles tiles that DID
 * attach to a city - just the wrong one. One-shot per damaged tile: the claim record is dropped, so
 * once the base game re-owns the tile it is no longer tracked and never released again.
 * @param {*} state Persisted state (mutated). @param {*} cities Local cities. @param {number} me Local player id.
 * @returns {number} Inner claims released this pass.
 */
function releaseInnerClaims(state, cities, me) {
  let released = 0;
  for (const k of Object.keys(state.claims)) {
    const c = state.claims[k];
    if (!c || c.by !== me) continue;
    const loc = unkey(k);
    if (!withinOwnNaturalRing(loc, cities)) continue;
    if (ownerAt(loc) === me) unclaim(loc); // hand it back; the base game re-grows + re-assigns it to the right city
    forgetClaim(state, k);
    released++;
  }
  return released;
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
  /** @type {Map<string, {civ:number, strength:number, culture:number, vitality:number}>} */
  const injectors = new Map();
  for (const s of settlements) {
    const k = key(s.loc.x, s.loc.y);
    if (!region.has(k)) continue;
    // culture/vitality ride along only for the debug injector line (logInjectors); the field ignores them.
    injectors.set(k, { civ: s.owner, strength: strengthOf(s), culture: s.culture, vitality: s.vitality });
  }
  return injectors;
}

/** Prune, persist, and report the state size + pass time (the last step of every pass). */
function finishPass(state, region, cities, radius, t0) {
  pruneFarField(state, region, cities, radius);
  pruneState(state);
  const bytes = saveState(state);
  logStateSize(state, bytes, Date.now() - t0);
}

/** The per-pass summary line: logged whenever anything changed or is in flight, and every pass in debug. */
function logPassSummary(state, c) {
  const done = c.confirmed;
  const busy = c.flips + c.pending + c.ceded + c.cedePending + c.healed + c.released
    + done.claim + done.cede + done.dropped;
  if (busy === 0 && !CONFIG.debug) return;
  log(`pass: ${c.flips} flip(s), ${c.pending} pending, ${c.ceded} ceded (${c.cedePending} pending), `
    + `confirmed ${done.claim} claim/${done.cede} cede (${done.dropped} dropped), `
    + `${c.healed} orphan(s) healed, ${c.released} inner tile(s) released to base game, `
    + `${Object.keys(state.field).length} active field tile(s)`);
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
  const confirmed = confirmPending(state); // book last pass's in-flight verbs from the live map before anything else

  const { w, h } = mapDims();
  const inBounds = (p) => (!w || (p.x >= 0 && p.x < w)) && (!h || (p.y >= 0 && p.y < h));
  const radius = Math.max(2, CONFIG.fieldRadius);
  const region = buildRegion(cities, radius, inBounds);

  const { ageInject, pace, ageCfg } = ageContext();
  const settlements = gatherSettlements();
  const { strengthOf, ethCtx } = injectionModel(settlements, ageInject);
  const injectors = buildInjectors(settlements, region, strengthOf);
  const threshold = Math.max(0, CONFIG.cultureThreshold);
  return { state, region, radius, injectors, threshold, ethCtx, ageCfg, pace, confirmed };
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

  const t0 = Date.now();
  const { state, region, radius, injectors, threshold, ethCtx, ageCfg, pace, confirmed } = preparePass(cities);
  const healed = repairOrphans(state, region, cities, me);
  const released = releaseInnerClaims(state, cities, me);
  const next = updateField(state, region, injectors, { threshold, ethCtx, ageCfg, pace });
  logFieldDiagnostics(injectors, cities, next, me, ageCfg);
  const { flips, pending, tiles, deadOwners } = resolveOwnership({ state, region, next, cities, me, ageCfg });
  const { ceded, pending: cedePending } = recedeOwnership({ state, region, next, me, ageCfg, deadOwners });

  finishPass(state, region, cities, radius, t0);
  logPassSummary(state, { flips, pending, ceded, cedePending, healed, released, confirmed });
  return {
    flips, pending, tiles, healed, released, ceded, cedePending,
    confirmed: confirmed.claim, confirmedCede: confirmed.cede
  };
}

/** Test/introspection helpers (pure). */
export const __test = {
  nearestCity, adjacentToMe, withinOwnNaturalRing, repairOrphans, releaseInnerClaims,
  claimBufferAt, commitBuffer, easeCrossing, effectiveWaterEase
};
