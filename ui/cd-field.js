// cd-field.js
//
// The pure reaction-diffusion math for the culture field (docs/current-model.md §2, adapted from
// the Civ V "Cultural Diffusion" model). No engine reads live here, so it is unit-tested in Node;
// cd-pass.js owns the persisted field and the engine reads and feeds them through these functions.
// Each turn a tile decays, diffuses to neighbors and cities inject; ownership is a read-out of the stock.

/** @param {*} v @param {number} [d] @returns {number} */
function num(v, d = 0) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/**
 * Culture a city injects into its own tile this turn (Civ V GetCityCulturalOutput, sqrt variant).
 * Self-amplifying: the stock climbs from `injectBase` toward its cap over many turns, so a mature
 * culture projects a big stock only later in the game.
 * @param {number} strength The city's cultural output (fused projection: culture x CPI x prosperity x celebration).
 * @param {number} currentOwnCulture The owner's culture already on the city tile.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Culture points to add (>= 0).
 */
export function injectionAmount(strength, currentOwnCulture, cfg) {
  const s = Math.max(0, num(strength));
  if (s <= 0) return 0;
  const ratio = Math.max(0, num(cfg.injectRatio, 0.15));
  const base = Math.max(0, num(cfg.injectBase, 10));
  const v = s * Math.sqrt(Math.max(0, num(currentOwnCulture)) * ratio) + base;
  return v > 0 && isFinite(v) ? v : base;
}

/**
 * The cap on total culture a city tile can hold, analogous to Civ V's
 * `(pop+output) * CULTURE_CITY_CAPED_FACTOR`. Bounds the self-amplifying injection.
 * @param {number} strength The city's cultural output.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Max culture on the city tile.
 */
export function cityCultureCap(strength, cfg) {
  return Math.max(0, num(strength)) * Math.max(1, num(cfg.cityCapFactor, 2000));
}

/**
 * Culture lost from a tile's stock this turn (Civ V DecayCulture): a percentage plus a flat point,
 * so small stocks fully dissipate and the front finds an equilibrium diffusion must keep pushing against.
 * @param {number} value Current culture value.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} The value after decay (>= 0).
 */
export function decayValue(value, cfg) {
  const v = Math.max(0, num(value));
  const d = v * Math.max(0, num(cfg.decayRate, 0.05)) + Math.max(0, num(cfg.decayFlat, 1));
  const next = v - d;
  return next > 0 ? next : 0;
}

/**
 * @typedef {Object} StepMods Terrain/affinity modifiers for one source->neighbor step.
 * @property {boolean} blocked True when culture cannot cross at all (water, or an ungated feature).
 * @property {number} bonus Additive diffusion-rate bonus fraction (road 1.0 = +100%, river 0.65).
 * @property {number} malus Additive diffusion-rate penalty fraction (0.10 = -ish via 1/(1+malus)).
 * @property {number} maxFactor Multiplier on the base neighbor cap (road x2.5, river x1.8, forest x0.8...).
 */

/**
 * Culture delivered from a source tile to one neighbor this turn (Civ V DiffuseCulture). The
 * neighbor asymptotes to at most `normalMax x maxFactor` (capped by `maxPercent`) of the source,
 * approached at the diffusion rate. Returns the add to the neighbor's stock (never lowers it).
 * @param {number} sourceValue The diffusing civ's culture on the source tile.
 * @param {number} prevTargetValue The same civ's culture already on the neighbor.
 * @param {StepMods} mods Terrain/affinity modifiers for this step.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Culture to add to the neighbor (>= 0).
 */
export function diffusionDelivered(sourceValue, prevTargetValue, mods, cfg) {
  const src = Math.max(0, num(sourceValue));
  if (src <= Math.max(0, num(cfg.cultureThreshold, 100))) return 0; // below threshold: no diffusion
  if (!mods || mods.blocked) return 0;
  const rate = Math.max(0, num(cfg.diffusionRate, 0.055));
  const bonus = Math.max(0, num(mods.bonus, 0));
  const malus = Math.max(0, num(mods.malus, 0));
  const effRate = (rate * (1 + bonus)) / (1 + malus);

  const normalMax = Math.max(0, num(cfg.normalMax, 0.4));
  const maxPercent = Math.max(0, num(cfg.maxPercent, 0.75));
  const cap = Math.min(src * maxPercent, src * normalMax * Math.max(0, num(mods.maxFactor, 1)));

  const delivered = src * effRate;
  const prev = Math.max(0, num(prevTargetValue));
  const next = Math.min(cap, prev + delivered);
  const add = next - prev;
  return add > 0 && isFinite(add) ? add : 0;
}

/**
 * The strongest living culture on a tile (ignoring dead civs).
 * @param {Record<string, number>} civMap civId -> culture value.
 * @param {number[]} dead Player ids to ignore.
 * @returns {{owner:number, value:number}} Winner + its value (owner -1 when none).
 */
function strongestCulture(civMap, dead) {
  let owner = -1;
  let value = 0;
  for (const key of Object.keys(civMap)) {
    const pid = parseInt(key, 10);
    if (dead.indexOf(pid) >= 0) continue;
    const v = num(civMap[key]);
    if (v > value) { value = v; owner = pid; }
  }
  return { owner, value };
}

/**
 * Resolve who should own a tile from its per-civ culture stock (Civ V UpdatePlotOwnership, the value
 * test only; distance/adjacency/lock are the caller's engine checks). The strongest culture wins, but
 * only past an absolute floor and (on owned land) a decisive ratio over the incumbent.
 * @param {Record<string, number>} civMap civId -> culture value on the tile.
 * @param {number} currentOwner Current owner player id (-1 = unowned).
 * @param {number[]} deadOwners Player ids to ignore (dead civs).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {{owner:number, value:number, incumbent:number, flip:boolean}} Verdict.
 */
export function resolveOwner(civMap, currentOwner, deadOwners, cfg) {
  const { owner, value } = strongestCulture(civMap, deadOwners || []);
  const minOwner = Math.max(0, num(cfg.minimumOwner, 300));
  const ratio = Math.max(0, num(cfg.flipRatio, 0.65));
  const incumbent = currentOwner >= 0 ? num(civMap[String(currentOwner)]) : 0;
  let flip = false;
  if (owner >= 0 && value > minOwner) {
    if (currentOwner < 0) flip = true;                                   // acquire empty land
    else if (owner !== currentOwner && value * ratio > incumbent) flip = true; // out-culture the incumbent decisively
  }
  return { owner, value, incumbent, flip };
}

/**
 * Whether the pass can ever move a tile toward its culture leader. The pass flips to the local player; with
 * `aiFlips` it also flips to any other major that leads (the caller has already checked the leader IS a major);
 * and it cedes back to a rival with recede on, only a tile the mod claimed for us. The pass, the recede step,
 * the lens and the hover readout all ask this one question so what they show and what they do cannot drift.
 * @param {number} leader Leading culture's player id (-1 = none). @param {number} owner Current owner (-1 = unowned).
 * @param {number} me Local player id. @param {boolean} claimedByMe Whether the mod claimed this tile for `me`.
 * @param {boolean|{recede?:boolean, aiFlips?:boolean}} flags CONFIG.recedeBorders as a plain boolean, or an object
 *   with `recede` and `aiFlips` (CONFIG.aiCultureFlips, and the caller has checked the leader is a living major).
 * @returns {boolean} True when the pass can act on the leader's win.
 */
export function passCanAct(leader, owner, me, claimedByMe, flags) {
  if (leader < 0 || leader === owner) return false;
  if (leader === me) return true;
  const f = flags && typeof flags === "object" ? flags : { recede: !!flags, aiFlips: false };
  if (f.aiFlips) return true;
  return !!f.recede && !!claimedByMe && owner === me;
}

/**
 * Convert a share of every foreign culture on a city tile to the city's owner (Civ V ConvertCulture): the owner's
 * stock grows by exactly what the others lose. Mutates and returns the row.
 * @param {Record<string, number>} row civId -> culture on the city tile.
 * @param {number} owner The city's owner.
 * @param {number} rate Fraction of each foreign stock converted this turn (clamped to [0,1]).
 * @returns {number} Total culture moved to the owner.
 */
export function convertCityCulture(row, owner, rate) {
  const r = Math.min(1, Math.max(0, num(rate)));
  if (!row || r <= 0 || owner < 0) return 0;
  const ownerKey = String(owner);
  let moved = 0;
  for (const civ of Object.keys(row)) {
    if (civ === ownerKey) continue;
    const v = num(row[civ]);
    if (v <= 0) continue;
    const take = v * r;
    row[civ] = v - take;
    moved += take;
  }
  if (moved > 0) row[ownerKey] = num(row[ownerKey]) + moved;
  return moved;
}

/**
 * Rewrite one tile's stocks for a city capture (Civ V CityCultureOnCapture): every culture loses `captureLoss`
 * of its stock, and the new owner gains `captureGain` of the total lost. Mutates and returns the row.
 * @param {Record<string, number>} row civId -> culture on the tile.
 * @param {number} newOwner The conqueror.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Culture the conqueror gained.
 */
export function applyCaptureTransfer(row, newOwner, cfg) {
  if (!row || newOwner < 0) return 0;
  const loss = Math.min(1, Math.max(0, num(cfg.captureLoss, 0.55)));
  const gain = Math.max(0, num(cfg.captureGain, 0.75));
  let lost = 0;
  for (const civ of Object.keys(row)) {
    const v = num(row[civ]);
    if (v <= 0) continue;
    const take = v * loss;
    row[civ] = v - take;
    lost += take;
  }
  const gained = lost * gain;
  if (gained > 0) row[String(newOwner)] = num(row[String(newOwner)]) + gained;
  return gained;
}

/**
 * A read-only view of the flip pressure on a tile, for the Cultural Pressure lens + hover tooltip.
 * Same gates as resolveOwner, re-expressed as a capture progress in [0,1] plus the raw stocks and the
 * target the leader must reach. Pure, so it is unit-tested alongside resolveOwner and cannot drift.
 * @param {Record<string, number>} civMap civId -> culture value on the tile.
 * @param {number} currentOwner Current owner player id (-1 = unowned).
 * @param {number[]} deadOwners Player ids to ignore (dead civs).
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config (age-adjusted bar).
 * @returns {{leader:number, leaderValue:number, incumbent:number, incumbentOwner:number,
 *   target:number, progress:number, willFlip:boolean}} Pressure verdict.
 */
export function pressureVerdict(civMap, currentOwner, deadOwners, cfg) {
  const { owner, value } = strongestCulture(civMap || {}, deadOwners || []);
  const minOwner = Math.max(0, num(cfg.minimumOwner, 300));
  const ratio = Math.max(0, num(cfg.flipRatio, 0.65));
  const incumbent = currentOwner >= 0 ? num(civMap && civMap[String(currentOwner)]) : 0;
  const target = flipTarget(currentOwner, incumbent, minOwner, ratio);
  const pending = owner >= 0 && owner !== currentOwner; // the leader is not the current owner
  const progress = pending && target > 0 ? clamp01(value / target) : 0;
  const willFlip = pending && clearsFlipGates(value, currentOwner, incumbent, minOwner, ratio);
  return { leader: owner, leaderValue: value, incumbent, incumbentOwner: currentOwner, target, progress, willFlip };
}

/**
 * Whether a leader's stock clears both flip gates: past the absolute floor and (on owned land)
 * decisively over the incumbent. Empty land needs only the floor.
 * @param {number} value Leader stock. @param {number} currentOwner Current owner (-1 = unowned).
 * @param {number} incumbent Incumbent stock. @param {number} minOwner Floor. @param {number} ratio flipRatio.
 * @returns {boolean} True when a flip is warranted.
 */
function clearsFlipGates(value, currentOwner, incumbent, minOwner, ratio) {
  if (value <= minOwner) return false;
  return currentOwner < 0 || value * ratio > incumbent;
}

/**
 * The stock the leader must reach to take a tile: past the absolute floor and (on owned land)
 * decisively over the incumbent (value*ratio > incumbent  <=>  value > incumbent/ratio). On empty
 * land only the floor applies. Mirrors resolveOwner's two gates exactly.
 * @param {number} currentOwner Current owner (-1 = unowned). @param {number} incumbent Incumbent stock.
 * @param {number} minOwner Absolute ownership floor. @param {number} ratio flipRatio.
 * @returns {number} The target stock.
 */
function flipTarget(currentOwner, incumbent, minOwner, ratio) {
  if (currentOwner < 0) return minOwner;
  return Math.max(minOwner, ratio > 0 ? incumbent / ratio : minOwner);
}

/** @param {number} v */
function clamp01(v) {
  if (!(v > 0)) return 0;
  return v > 1 ? 1 : v;
}

/**
 * Turns until a tile flips to its leader, projected on the patch of field around it. The field's own turn is repeated
 * on the plot and the tiles near it (decay, then each neighbour adds up to its cap on that tile: its stock x normalMax
 * x the step's maxFactor), with the edge of the patch held where it is and no tile but the plot allowed to fall. So a
 * plot behind a front that's still rising is carried over by it, and a plot whose neighbours have stopped levels off
 * where the field does; a hill in the desert sitting at half the bar reads as stalled, not "~1 turn". A held tile
 * carries its `rise` each turn (how fast it has been rising), so a border still filling in behind the plot lifts
 * it the way the field will. Injection and the diaspora bonus are left out. Pure. Returns null when there is no
 * pending flip, 0 when already over the bar, and Infinity when the patch stops moving with the plot under the bar
 * or it doesn't get there within `horizon` turns.
 * @param {{leader:number, leaderValue:number, target:number, willFlip:boolean}} verdict A pressureVerdict.
 * @param {{nodes:{value:number, threshold?:number, fixed?:boolean, rise?:number}[],
 *   links:{from:number, to:number, mods:StepMods, gate?:number}[]}} patch The leader's stock on the plot (node 0) and
 *   the tiles around it, each tile's source threshold and whether it's held, and the steps between them with their
 *   modifiers and the source stock each needs to cross.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @param {number} [horizon] Turns projected before calling it stalled.
 * @returns {number|null} Estimated turns, 0 (ready), Infinity (stalled), or null (no pending flip).
 */
export function estimateTurnsToFlip(verdict, patch, cfg, horizon = 50) {
  if (!verdict || verdict.leader < 0 || verdict.leader === verdict.incumbentOwner) return null;
  if (verdict.willFlip || verdict.target - verdict.leaderValue <= 0) return 0;
  const { nodes, links } = patchParts(patch);
  let v = nodes.map((n) => Math.max(0, num(n.value)));
  v[0] = Math.max(0, num(verdict.leaderValue));
  for (let turn = 1; turn <= horizon; turn++) {
    const next = patchStep(v, nodes, links, cfg);
    if (next[0] >= verdict.target) return turn;
    if (!moved(v, next)) return Infinity;
    v = next;
  }
  return Infinity;
}

/** A patch's nodes and links, with a lone plot standing in for a missing one. */
function patchParts(patch) {
  const nodes = patch && Array.isArray(patch.nodes) && patch.nodes.length ? patch.nodes : [{ value: 0 }];
  return { nodes, links: patch && Array.isArray(patch.links) ? patch.links : [] };
}

/** One field turn on the patch: decay, deliver along each link from last turn's stock, then hold the floors. */
function patchStep(v, nodes, links, cfg) {
  const next = v.map((x, i) => (nodes[i].fixed ? x + Math.max(0, num(nodes[i].rise, 0)) : decayValue(x, cfg)));
  for (const l of links) {
    if (nodes[l.to].fixed || !(v[l.from] > Math.max(num(nodes[l.from].threshold, 0), num(l.gate, 0)))) continue;
    next[l.to] += diffusionDelivered(v[l.from], next[l.to], l.mods, cfg);
  }
  for (let i = 1; i < next.length; i++) if (next[i] < v[i]) next[i] = v[i];
  return next;
}

/** Whether any tile in the patch moved by half a point or more. */
function moved(a, b) {
  for (let i = 0; i < a.length; i++) if (Math.abs(b[i] - a[i]) >= 0.5) return true;
  return false;
}

/** Test/introspection helpers. */
export const __test = { num, strongestCulture };
