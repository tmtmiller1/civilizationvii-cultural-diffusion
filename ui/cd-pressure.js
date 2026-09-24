// cd-pressure.js
//
// The PURE injection-strength math (docs/current-model.md §3); no engine reads, unit-testable in
// Node. cd-pass.js feeds per-settlement signals through `projectionOf` to get how hard each city
// PUMPS culture into its own tile; CPI and ethnic affinity are applied by the pass around this base.

/**
 * @typedef {Object} Settlement
 * @property {number} owner Owner player id.
 * @property {{x:number,y:number}} loc City-center location.
 * @property {number} culture Net culture yield per turn (>= 0).
 * @property {number} happiness Net happiness per turn (may be negative).
 * @property {number} wonders Wonder count.
 * @property {boolean} celebrating Whether the owner is in a Golden Age.
 * @property {number} [prosperity] Normalized prosperity signal in [-1,1] (0 = neutral). Optional - absent = neutral.
 * @property {number} [vitality] Positive prosperity/vitality magnitude (cd-polity.vitalityOf); the
 *   aggregate blended with culture in the fused base.
 */

/**
 * Hex (offset) distance between two plots. Uses the odd-r -> cube conversion so distance is
 * correct on Civ's staggered hex grid, not naive Chebyshev.
 * @param {{x:number,y:number}} a Plot A.
 * @param {{x:number,y:number}} b Plot B.
 * @returns {number} Hex distance in tiles.
 */
export function hexDistance(a, b) {
  const ax = a.x - ((a.y - (a.y & 1)) >> 1);
  const az = a.y;
  const ay = -ax - az;
  const bx = b.x - ((b.y - (b.y & 1)) >> 1);
  const bz = b.y;
  const by = -bx - bz;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

/**
 * The happiness factor: unhappy cities project weakly, ecstatic ones a little harder. Bounded
 * to [1-amp, 1+amp] so happiness shapes but never dominates.
 * @param {number} happiness Net happiness per turn.
 * @param {number} amp Amplitude (config.happinessAmp).
 * @returns {number} Multiplier in [1-amp, 1+amp].
 */
export function happinessFactor(happiness, amp) {
  const a = Math.max(0, amp);
  const squashed = Math.tanh((typeof happiness === "number" ? happiness : 0) / 8);
  return 1 + a * squashed;
}

/**
 * The wonder/great-work amplifier for a settlement.
 * @param {number} wonders Wonder count.
 * @param {number} bonus Per-wonder bonus (config.wonderBonus).
 * @returns {number} Multiplier (>= 1).
 */
export function wonderFactor(wonders, bonus) {
  return 1 + Math.max(0, bonus) * Math.max(0, wonders || 0);
}

/**
 * Prosperity factor: a prosperous, growing settlement pumps culture harder; a struggling one
 * weaker. `prosperity` is normalized in [-1,1] (0 = neutral); absent/NaN -> neutral 1.
 * @param {number|undefined} prosperity Normalized prosperity signal.
 * @param {number} amp Amplitude (config.prosperityAmp).
 * @returns {number} Multiplier in [1-amp, 1+amp].
 */
export function prosperityFactor(prosperity, amp) {
  const a = Math.max(0, typeof amp === "number" ? amp : 0);
  const p = typeof prosperity === "number" && isFinite(prosperity) ? Math.max(-1, Math.min(1, prosperity)) : 0;
  return 1 + a * p;
}

/**
 * Ethnic-affinity factor: diffusion into a tile saturated with a civ's diaspora
 * is accelerated - borders follow people. `affinity` is the diaspora share in [0,1]; null/NaN
 * (no emigration data) -> neutral 1.
 * @param {number|null|undefined} affinity Diaspora share in [0,1].
 * @param {number} weight Amplitude (config.ethnicWeight).
 * @returns {number} Multiplier in [1, 1+weight].
 */
export function ethnicFactor(affinity, weight) {
  const w = Math.max(0, typeof weight === "number" ? weight : 0);
  const a = typeof affinity === "number" && isFinite(affinity) ? Math.max(0, Math.min(1, affinity)) : 0;
  return 1 + w * a;
}

/**
 * The fused GEOMETRIC BLEND base `culture^alpha x vitality^(1-alpha)` (alpha = cultureExponent, clamped to
 * [0,1]); vitality defaults to culture when absent/non-finite.
 * @param {number} culture Weighted culture (> 0).
 * @param {Settlement} s Settlement.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Blended base.
 */
function fusedBase(culture, s, cfg) {
  const rawAlpha = typeof cfg.cultureExponent === "number" ? cfg.cultureExponent : 0.65;
  const alpha = Math.min(1, Math.max(0, rawAlpha));
  const hasVitality = typeof s.vitality === "number" && isFinite(s.vitality);
  const vitality = Math.max(1e-6, hasVitality ? s.vitality : culture);
  return Math.pow(culture, alpha) * Math.pow(vitality, 1 - alpha);
}

/**
 * A settlement's cultural INJECTION strength - how hard it pumps culture into its own tile,
 * the source of the diffusion field.
 *
 * The fused base is a GEOMETRIC BLEND `culture^alpha x vitality^(1-alpha)` (alpha = `cultureExponent`),
 * so a lone +culture ability is a single concave term and powerhouses lead without running away.
 * Wonders feed the CPI and happiness lives inside `vitality` (no double-counts); with `fusedModel`
 * off it degrades to plain culture (x celebration x age).
 * @param {Settlement} s Settlement.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Non-negative injection strength.
 */
export function projectionOf(s, cfg) {
  const culture = Math.max(0, s.culture) * Math.max(0, cfg.cultureWeight);
  if (culture <= 0) return 0;
  const celebrate = s.celebrating ? 1.25 : 1.0;
  const age = Math.max(0.1, cfg.ageFactor);
  const base = cfg.fusedModel ? fusedBase(culture, s, cfg) : culture;
  const p = base * celebrate * age;
  return p > 0 && isFinite(p) ? p : 0;
}
