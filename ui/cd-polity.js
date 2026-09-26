// cd-polity.js
//
// Per-settlement cultural signals the pressure model reads: net culture yield, net happiness,
// wonder count, and celebration (Golden Age) state. Every read is defensive - an unreadable
// value degrades to a neutral default and never throws.

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
 * Resolve a YieldTypes enum value by key.
 * @param {string} key e.g. "YIELD_CULTURE".
 * @returns {*} The enum value, or undefined.
 */
function yEnum(key) {
  return safe(() => (typeof YieldTypes !== "undefined" ? YieldTypes[key] : undefined), undefined);
}

/**
 * Read one NET yield off a city (prefer getNetYield, fall back to gross getYield).
 * @param {*} city City object. @param {string} key Yield enum key.
 * @returns {number} The yield, or 0.
 */
function readYield(city, key) {
  return safe(() => {
    const y = city && city.Yields;
    if (!y) return 0;
    const e = yEnum(key);
    let v = typeof y.getNetYield === "function" ? y.getNetYield(e) : undefined;
    if (typeof v !== "number" || !isFinite(v)) {
      v = typeof y.getYield === "function" ? y.getYield(e) : 0;
    }
    return typeof v === "number" && isFinite(v) ? v : 0;
  }, 0);
}

/**
 * A city's net culture yield per turn.
 * @param {*} city City object.
 * @returns {number} Culture yield (>= 0).
 */
export function cultureOf(city) {
  return Math.max(0, readYield(city, "YIELD_CULTURE"));
}

/**
 * A city's net happiness per turn (prefer the Happiness subsystem).
 * @param {*} city City object.
 * @returns {number} Net happiness (may be negative).
 */
export function happinessOf(city) {
  const h = safe(() => city?.Happiness?.netHappinessPerTurn, undefined);
  if (typeof h === "number" && isFinite(h)) return h;
  return readYield(city, "YIELD_HAPPINESS");
}

/**
 * A city's population (the base UI reads `city.population`), or 0 when unreadable.
 * @param {*} city City object.
 * @returns {number} Population (>= 0).
 */
export function populationOf(city) {
  return safe(() => {
    const p = city?.population;
    if (typeof p === "number" && isFinite(p)) return Math.max(0, p);
    const g = city?.Growth?.population;
    return typeof g === "number" && isFinite(g) ? Math.max(0, g) : 0;
  }, 0);
}

/** The wonders list from whichever component exposes it, or null. */
function wondersList(city) {
  return city?.Constructibles?.getWonders?.() ?? city?.Wonders?.getWonders?.();
}

/**
 * The number of Wonders built in a city (best-effort; 0 if unreadable).
 * @param {*} city City object.
 * @returns {number} Wonder count.
 */
export function wonderCountOf(city) {
  return safe(() => {
    const wonders = wondersList(city);
    if (Array.isArray(wonders)) return wonders.length;
    const n = city?.Constructibles?.getNumWonders?.();
    return typeof n === "number" && isFinite(n) ? n : 0;
  }, 0);
}
/**
 * A settlement's POSITIVE prosperity/vitality magnitude in roughly culture-comparable units
 * (happiness + food + production + a little gold/science): the aggregate the injection base
 * geometrically blends with culture so a lone +culture ability is one concave term. Base-game reads
 * only. @param {*} city City object. @returns {number} Vitality magnitude (>= 0).
 */
export function vitalityOf(city) {
  const happ = Math.max(0, happinessOf(city));
  const food = Math.max(0, readYield(city, "YIELD_FOOD"));
  const prod = Math.max(0, readYield(city, "YIELD_PRODUCTION"));
  const gold = Math.max(0, readYield(city, "YIELD_GOLD"));
  const sci = Math.max(0, readYield(city, "YIELD_SCIENCE"));
  const v = happ * 0.5 + food * 0.35 + prod * 0.3 + gold * 0.15 + sci * 0.15;
  return v > 0 && isFinite(v) ? v : 0;
}

/**
 * A settlement's normalized prosperity signal in [-1,1] (0 = neutral) for the projection
 * multiplier: a prosperous, happy city beams culture farther; a struggling one contracts. Built
 * from base-game reads only (net happiness + food/production), squashed with tanh.
 * @param {*} city City object.
 * @returns {number} Prosperity in [-1,1].
 */
export function prosperityOf(city) {
  const happ = happinessOf(city);
  const food = Math.max(0, readYield(city, "YIELD_FOOD"));
  const prod = Math.max(0, readYield(city, "YIELD_PRODUCTION"));
  const score = happ * 0.4 + food * 0.08 + prod * 0.04;
  const p = Math.tanh(score / 5);
  return isFinite(p) ? p : 0;
}

/**
 * Whether a city's owner is currently celebrating (Golden Age), which amplifies
 * cultural projection.
 * @param {number} owner Owner player id.
 * @returns {boolean} True when celebrating.
 */
export function isCelebrating(owner) {
  return safe(() => {
    const p = Players?.get?.(owner);
    const happ = p?.Happiness;
    if (!happ) return false;
    if (typeof happ.isInGoldenAge === "function") return !!happ.isInGoldenAge();
    if (typeof happ.getGoldenAgeTurnsRemaining === "function") {
      return happ.getGoldenAgeTurnsRemaining() > 0;
    }
    return false;
  }, false);
}

/**
 * The current age's type name ("AGE_ANTIQUITY" / "AGE_EXPLORATION" / "AGE_MODERN"), or "" when unreadable.
 * In the shipped engine `Game.age` is a numeric HASH, so it is resolved through
 * `GameInfo.Ages.lookup(Game.age).AgeType`; a string is accepted as-is (test stubs).
 * @returns {string} Age type name, or "".
 */
export function currentAgeType() {
  const age = rawAge();
  if (typeof age === "string") return age;
  const row = ageRow(age);
  return row && typeof row.AgeType === "string" ? row.AgeType : "";
}

/** @returns {*} The engine's raw current-age value (a hash on the shipped engine), or undefined. */
function rawAge() {
  return safe(() => Game?.age ?? GameContext?.age, undefined);
}

/** @param {*} age Raw age value. @returns {*} Its GameInfo.Ages row, or null. */
function ageRow(age) {
  return safe(() => (typeof GameInfo !== "undefined" ? GameInfo?.Ages?.lookup?.(age) : null), null);
}

/**
 * The current age key for per-age tuning: "ANTIQUITY" | "EXPLORATION" | "MODERN".
 * Defaults to "ANTIQUITY" when unreadable.
 * @returns {"ANTIQUITY"|"EXPLORATION"|"MODERN"} Age key.
 */
export function currentAgeKey() {
  const age = currentAgeType();
  if (age.includes("MODERN")) return "MODERN";
  if (age.includes("EXPLORATION")) return "EXPLORATION";
  return "ANTIQUITY";
}
