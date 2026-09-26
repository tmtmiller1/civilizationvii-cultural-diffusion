// cd-conversion.js
//
// The per-turn CONVERSION rate of a city (Civ V ConvertCulture, docs/civ-v-parity-spec.md §4): the fraction of
// every foreign culture group's stock on the city tile that passes to the city's owner each turn. A flat base
// (`convertBase`, Civ V's 0.5%) plus a bonus per constructible in the city and per tradition or ideology its owner
// holds, all from the data table `convertBonuses` keyed by type NAME, so an age or DLC with different buildings
// needs no code change. A type the table does not know is simply ignored; nothing here throws into the pass.
//
// Engine reads (all defensive): city.Constructibles.getIds() -> ComponentID[] (array-LIKE, iterate, never
// Array.isArray), Constructibles.get(id).type -> GameInfo.Constructibles.lookup(type).ConstructibleType;
// Players.get(pid).Culture.getActiveTraditions(slot) -> GameInfo.Traditions.lookup(t).TraditionType;
// Culture.getChosenIdeology() -> GameInfo.Ideologies.lookup(i).IdeologyType (Modern age only).

/** @param {()=>*} fn Thunk. @param {*} fallback Fallback. @returns {*} fn() or fallback. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** @param {*} v @param {number} d @returns {number} A finite number, else the fallback. */
function num(v, d) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/**
 * The type names of every constructible standing in a city (buildings, wonders, improvements).
 * @param {*} city Engine city.
 * @returns {string[]} Constructible type names (empty when unreadable).
 */
export function cityConstructibleTypes(city) {
  return safe(() => {
    const ids = city?.Constructibles?.getIds?.();
    if (!ids) return [];
    /** @type {string[]} */
    const out = [];
    for (const id of ids) {
      const inst = safe(() => Constructibles?.get?.(id), null);
      const t = inst ? inst.type : undefined;
      const name = t != null ? safe(() => GameInfo?.Constructibles?.lookup?.(t)?.ConstructibleType, null) : null;
      if (typeof name === "string") out.push(name);
    }
    return out;
  }, []);
}

/** @returns {*[]} The culture slot enum values present on this build (policy, tradition, normal). */
function cultureSlots() {
  const slots = typeof CultureSlotTypes !== "undefined" ? CultureSlotTypes : null;
  if (!slots) return [];
  return [slots.POLICY_CULTURE_SLOT, slots.TRADITION_CULTURE_SLOT, slots.NORMAL_CULTURE_SLOT].filter((v) => v != null);
}

/**
 * The type names of the traditions a player has slotted, plus its chosen ideology when it has one.
 * @param {number} pid Player id.
 * @returns {string[]} Tradition and ideology type names (empty when unreadable).
 */
export function playerCultureTypes(pid) {
  const culture = safe(() => Players?.get?.(pid)?.Culture, null);
  if (!culture) return [];
  const out = traditionNames(culture);
  const ideology = ideologyName(culture);
  if (ideology) out.push(ideology);
  return out;
}

/** @param {*} culture A player's Culture component. @returns {string[]} Distinct slotted tradition type names. */
function traditionNames(culture) {
  /** @type {string[]} */
  const out = [];
  if (typeof culture.getActiveTraditions !== "function") return out;
  for (const slot of cultureSlots()) {
    const arr = safe(() => culture.getActiveTraditions(slot), null);
    if (!arr) continue;
    safe(() => {
      for (const t of arr) {
        const name = safe(() => GameInfo?.Traditions?.lookup?.(t)?.TraditionType, null);
        if (typeof name === "string" && out.indexOf(name) < 0) out.push(name);
      }
    }, null);
  }
  return out;
}

/** @param {*} culture A player's Culture component. @returns {string|null} The chosen ideology's type name. */
function ideologyName(culture) {
  if (typeof culture.getChosenIdeology !== "function") return null;
  const name = safe(() => GameInfo?.Ideologies?.lookup?.(culture.getChosenIdeology())?.IdeologyType, null);
  return typeof name === "string" ? name : null;
}

/**
 * PURE: the conversion rate for a set of type names: `convertBase` plus every matching `convertBonuses` entry,
 * clamped to [0,1]. Unknown names contribute nothing.
 * @param {string[]} typeNames Constructible, tradition and ideology type names.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Fraction of each foreign stock converted per turn.
 */
export function conversionRateFor(typeNames, cfg) {
  let rate = Math.max(0, num(cfg.convertBase, 0));
  const table = cfg.convertBonuses && typeof cfg.convertBonuses === "object" ? cfg.convertBonuses : {};
  for (const name of typeNames || []) {
    const b = table[name];
    if (typeof b === "number" && isFinite(b) && b > 0) rate += b;
  }
  return Math.min(1, rate);
}

/**
 * The conversion rate of a live city: its constructibles plus its owner's traditions and ideology.
 * @param {*} city Engine city. @param {number} owner The city's owner.
 * @param {import("/cultural-diffusion/ui/cd-config.js").CdConfig} cfg Live config.
 * @returns {number} Fraction of each foreign stock converted this turn.
 */
export function conversionRate(city, owner, cfg) {
  return conversionRateFor(cityConstructibleTypes(city).concat(playerCultureTypes(owner)), cfg);
}
