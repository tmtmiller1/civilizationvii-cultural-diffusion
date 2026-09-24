// cd-cpi.js
//
// The PURE Cultural Power Index math (docs/current-model.md §3); no engine reads, unit-testable in
// Node. cd-metrics.js gathers the raw per-civ dimensions and cd-pass.js applies the resulting
// multiplier. CPI is a civ's overall cultural power: each dimension as a share vs the STRONGEST
// civ, combined as a geometric weighted mean so breadth beats a single-stat spike.

const EPS = 1e-6;

/**
 * The canonical CPI dimension keys, in the order cd-metrics/cd-config name them.
 * @type {readonly string[]}
 */
export const CPI_DIMENSIONS = Object.freeze(["legacy", "flow", "reach", "vitality", "prosperity", "identity"]);

/**
 * Normalize each dimension to a per-civ share of the STRONGEST civ in that dimension
 * (share in [0,1]; the leader is 1). A dimension where every civ reads 0 (or the data is
 * unavailable) is dropped entirely, so an unreadable subsystem never zeroes a civ's CPI.
 * @param {Map<number, Record<string, number>>} rawByOwner owner id -> raw dimension values.
 * @param {readonly string[]} [dims] Dimension keys to consider (default CPI_DIMENSIONS).
 * @returns {{shares: Map<number, Record<string, number>>, liveDims: string[]}} Per-civ shares +
 *   the dimensions that had any signal.
 */
export function sharesVsMax(rawByOwner, dims = CPI_DIMENSIONS) {
  /** @type {Record<string, number>} */
  const max = {};
  for (const d of dims) max[d] = 0;
  for (const raw of rawByOwner.values()) {
    for (const d of dims) {
      const v = num(raw[d]);
      if (v > max[d]) max[d] = v;
    }
  }
  const liveDims = dims.filter((d) => max[d] > 0);
  /** @type {Map<number, Record<string, number>>} */
  const shares = new Map();
  for (const [owner, raw] of rawByOwner) {
    /** @type {Record<string, number>} */
    const row = {};
    for (const d of liveDims) row[d] = clamp01(num(raw[d]) / max[d]);
    shares.set(owner, row);
  }
  return { shares, liveDims };
}

/**
 * Geometric weighted mean of a civ's dimension shares -> its CPI in (0,1], so a broadly strong civ
 * beats one spiking a single dimension. Weights are auto-normalized over the live dimensions, and
 * each share is floored by EPS so one empty dimension can't collapse CPI to exactly 0.
 * @param {Record<string, number>} shares Dimension -> share in [0,1].
 * @param {Record<string, number>} weights Dimension -> weight (need not sum to 1).
 * @param {readonly string[]} dims Live dimension keys to combine.
 * @returns {number} CPI in (0,1].
 */
export function computeCPI(shares, weights, dims) {
  let wsum = 0;
  for (const d of dims) wsum += Math.max(0, num(weights[d]));
  if (!(wsum > 0) || !dims.length) return 0.5; // no weighting info -> neutral
  let acc = 0;
  for (const d of dims) {
    const w = Math.max(0, num(weights[d]));
    if (w <= 0) continue;
    const share = clamp01(num(shares[d]));
    acc += (w / wsum) * Math.log(share + EPS);
  }
  const cpi = Math.exp(acc);
  return cpi > 0 && isFinite(cpi) ? Math.min(1, cpi) : EPS;
}

/**
 * Map a CPI in [0,1] into a bounded pressure multiplier: the cultural hegemon (CPI->1) projects
 * at cpiPowerMax, a culturally weak civ (CPI->0) at cpiPowerMin. cpiPowerMin/Max control the
 * SPREAD between civs (their relative border reach).
 * @param {number} cpi CPI in [0,1].
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Multiplier in [cpiPowerMin, cpiPowerMax].
 */
export function fPower(cpi, cfg) {
  const lo = num(cfg && cfg.cpiPowerMin, 1);
  const hi = num(cfg && cfg.cpiPowerMax, 1);
  const t = clamp01(num(cpi, 0.5));
  const m = lo + (hi - lo) * t;
  return m > 0 && isFinite(m) ? m : 1;
}

/**
 * Convenience: raw per-civ dimensions -> per-civ f_power multiplier map, in one call.
 * @param {Map<number, Record<string, number>>} rawByOwner owner -> raw dimensions.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {{power: Map<number, number>, cpi: Map<number, number>}} Per-civ power multiplier + CPI (for logging).
 */
export function powerMultipliers(rawByOwner, cfg) {
  const weights = {
    legacy: num(cfg.wLegacy, 1), flow: num(cfg.wFlow, 1), reach: num(cfg.wReach, 1),
    vitality: num(cfg.wVitality, 1), prosperity: num(cfg.wProsperity, 1), identity: num(cfg.wIdentity, 1)
  };
  const { shares, liveDims } = sharesVsMax(rawByOwner);
  /** @type {Map<number, number>} */
  const power = new Map();
  /** @type {Map<number, number>} */
  const cpi = new Map();
  for (const [owner, row] of shares) {
    const c = computeCPI(row, weights, liveDims);
    cpi.set(owner, c);
    power.set(owner, fPower(c, cfg));
  }
  return { power, cpi };
}

/** @param {*} v @param {number} [d] @returns {number} */
function num(v, d = 0) {
  return typeof v === "number" && isFinite(v) ? v : d;
}
/** @param {number} v @returns {number} v clamped to [0,1]. */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Test/introspection helpers. */
export const __test = { num, clamp01, EPS };
