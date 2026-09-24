// cd-civ-tuning.js
//
// The per-leader / per-civilization / per-memento VARIANCE layer: a deliberately tiny, bounded
// registry of nudges to a civ's cultural INJECTION STRENGTH. Magnitude outliers (culture / wonder /
// celebration engines) are flattened structurally by the geometric injection base and are NOT listed;
// this table is reserved for REDUNDANCY, i.e. kits that ALREADY grow territory and would double-dip.
// Grounded in mods_research_and_analysis/cultural-diffusion-leader-civ-memento-and-age-tuning.md.
// Keys are GameInfo string types: leaderType via GameInfo.Leaders.lookup(...).LeaderType
// (persona `_ALT` normalized), civilizationType via GameInfo.Civilizations.lookup(...).CivilizationType.
// GATED by CONFIG.civTuningEnabled; compressed toward neutral by CONFIG.civTuningStrength.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { LEADER_ROSTER, CIV_ROSTER, MEMENTO_ROSTER } from "/cultural-diffusion/ui/cd-civ-roster.js";

/** The neutral profile: no change to injection strength. */
export const NEUTRAL = Object.freeze({ injectionScale: 1 });

const CIVLEADER_BOUNDS = [0.6, 1.5]; // a single civ/leader entry
const MEMENTO_BOUNDS = [0.8, 1.2];   // a memento stack (they compose multiplicatively)
const FINAL_BOUNDS = [0.55, 1.6];    // the resolved product

/**
 * Per-leader injection nudges - REDUNDANCY only. (Culture/celebration/suzerainty magnitude is
 * flattened by the composite injection base, so those leaders are intentionally absent.)
 * @type {Record<string, {injectionScale:number}>}
 */
export const BY_LEADER = {
  // Culture-on-capture MANUFACTURES the culture the mod then spreads onto conquered land - a
  // war-expansion x culture-expansion loop the score can't untangle. Settlement cap adds injectors.
  LEADER_XERXES: { injectionScale: 0.8 }
};

/**
 * Per-civilization injection nudges - REDUNDANCY only: civs whose kit ALREADY grows territory,
 * so diffusion on the same cities double-dips on border value. Pure culture/wonder engines
 * (Greece, Rome, Maya, Ming, Qing, Siam, ...) are NOT listed - the composite base handles them.
 * @type {Record<string, {injectionScale:number}>}
 */
export const BY_CIV = {
  CIVILIZATION_MONGOLIA: { injectionScale: 0.82 }, // conquest expansion compounds with tile flipping
  CIVILIZATION_SPAIN: { injectionScale: 0.85 },    // settlement yields + town->city conversion (Distant Lands)
  // territory-culture (quarters/tundra) + settlement scaling (culture leg is structural;
  // this trims the territory leg)
  CIVILIZATION_RUSSIA: { injectionScale: 0.88 },
  CIVILIZATION_AMERICA: { injectionScale: 0.9 }    // frontier-expansion theme
};

/**
 * Per-memento injection nudges. EMPTY: no memento grants territory (no redundancy), and every
 * culture/happiness memento's magnitude is already flattened by the composite injection base.
 * @type {Record<string, {injectionScale:number}>}
 */
export const BY_MEMENTO = {};

/** Roster keys with no tuning entry (for the completeness test - informational, not an error). */
export const UNTUNED_LEADERS = LEADER_ROSTER.filter((k) => !Object.hasOwn(BY_LEADER, k));
export const UNTUNED_CIVS = CIV_ROSTER.filter((k) => !Object.hasOwn(BY_CIV, k));
export const UNTUNED_MEMENTOS = MEMENTO_ROSTER.filter((k) => !Object.hasOwn(BY_MEMENTO, k));

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalized base leader type for a player (`_ALT` stripped), or null. */
function leaderName(pid) {
  try {
    const n = GameInfo?.Leaders?.lookup?.(Players?.get?.(pid)?.leaderType)?.LeaderType;
    return typeof n === "string" ? n.replace(/_ALT$/, "") : null;
  } catch (_) { return null; }
}

/** Civilization type for a player, or null. */
function civName(pid) {
  try {
    const n = GameInfo?.Civilizations?.lookup?.(Players?.get?.(pid)?.civilizationType)?.CivilizationType;
    return typeof n === "string" ? n : null;
  } catch (_) { return null; }
}

/** The MEMENTO_* id carried by an equipped entry across runtime shapes, or null. */
function mementoIdOf(entry) {
  if (!entry) return null;
  for (const c of [entry, entry.mementoTypeId, entry.mementoType, entry.Type, entry.type, entry.id, entry.value]) {
    if (typeof c === "string" && c.startsWith("MEMENTO_")) return c;
  }
  return null;
}

/** Equipped memento ids for a player (empty when the metaprogression API is unavailable). */
function equippedMementos(pid) {
  try {
    const meta = Online?.Metaprogression;
    if (!meta || typeof meta.getEquippedMementos !== "function") return [];
    const raw = meta.getEquippedMementos(pid);
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const e of raw) { const id = mementoIdOf(e); if (id) out.push(id); }
    return Array.from(new Set(out));
  } catch (_) { return []; }
}

/** The combined memento injection scale for a player (clamped), or 1 when none apply. */
function mementoScale(pid) {
  let s = 1;
  let any = false;
  for (const id of equippedMementos(pid)) {
    const t = BY_MEMENTO[id];
    if (t) { s *= t.injectionScale; any = true; }
  }
  return any ? clamp(s, MEMENTO_BOUNDS[0], MEMENTO_BOUNDS[1]) : 1;
}

/** Compress a scale toward neutral (1) by CONFIG.civTuningStrength (1 = full, 0 = flat). */
function flatten(scale) {
  const raw = CONFIG.civTuningStrength;
  const s = typeof raw === "number" ? clamp(raw, 0, 1) : 1;
  return 1 + (scale - 1) * s;
}

/**
 * The clamped civ/leader base scale x memento multiplier for a player, or null when neither the
 * civ nor leader table has an entry AND no memento applies (caller returns NEUTRAL).
 * @param {number} pid Player id.
 * @param {number} mem Memento multiplier.
 * @returns {number|null} Combined pre-flatten scale, or null.
 */
function baseTimesMemento(pid, mem) {
  const civ = BY_CIV[civName(pid)];
  const lead = BY_LEADER[leaderName(pid)];
  const base = lead?.injectionScale ?? civ?.injectionScale ?? null;
  if (base == null && mem === 1) return null;
  const clampedBase = clamp(base == null ? 1 : base, CIVLEADER_BOUNDS[0], CIVLEADER_BOUNDS[1]);
  return clamp(clampedBase * mem, FINAL_BOUNDS[0], FINAL_BOUNDS[1]);
}

/**
 * The injection-strength tuning for a player: its civ entry, overridden by its leader entry, times
 * its equipped-memento stack, clamped, then compressed toward neutral by CONFIG.civTuningStrength.
 * Returns the shared NEUTRAL profile when the layer is disabled or nothing matches.
 * @param {number} pid Player id.
 * @returns {{injectionScale:number}} The resolved tuning.
 */
export function civTuning(pid) {
  if (!CONFIG.civTuningEnabled || typeof pid !== "number") return NEUTRAL;
  const scale = baseTimesMemento(pid, mementoScale(pid));
  if (scale == null) return NEUTRAL;
  const flattened = flatten(scale);
  return flattened === 1 ? NEUTRAL : { injectionScale: flattened };
}

/**
 * Test/introspection helpers (pure). The memento/name resolvers are exposed because the public
 * `civTuning` path cannot observe them while BY_MEMENTO ships empty.
 */
export const __test = {
  clamp, flatten, mementoScale, leaderName, civName, mementoIdOf, equippedMementos, baseTimesMemento,
  CIVLEADER_BOUNDS, MEMENTO_BOUNDS, FINAL_BOUNDS
};
