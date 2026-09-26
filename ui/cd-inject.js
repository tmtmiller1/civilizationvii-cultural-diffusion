// cd-inject.js
//
// Field step 3, the CITY side of the culture field: each settlement pumps culture into its own tile, and - with
// foreignCultureInCities (docs/civ-v-parity-spec.md §3 and §4) - pumps every other culture group living there too,
// then converts a share of those foreign stocks to its owner each turn. Plus the owner floor (spec §8). Pure field
// arithmetic over the pass's rows; the only engine reads are the owner of a tile (for the floor) and, through
// cd-conversion.js, the city's buildings and its owner's traditions. No import from cd-pass.js: a UIScript module
// cycle can take down the whole graph in GameFace.

import { CONFIG } from "/cultural-diffusion/ui/cd-config.js";
import { ownerAt } from "/cultural-diffusion/ui/cd-plots.js";
import { injectionAmount, cityCultureCap, convertCityCulture } from "/cultural-diffusion/ui/cd-field.js";
import { conversionRate } from "/cultural-diffusion/ui/cd-conversion.js";
import { shareOfCiv } from "/cultural-diffusion/ui/cd-emigration.js";

/** @param {string} k Plot key. @returns {{x:number,y:number}} Location. */
function unkey(k) {
  const i = k.indexOf(",");
  return { x: parseInt(k.slice(0, i), 10), y: parseInt(k.slice(i + 1), 10) };
}

/** @param {*} v @param {number} d @returns {number} A finite number, else the fallback. */
function num(v, d) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/** @param {Record<string, number>|undefined} row A field row. @returns {number} The total culture on the tile. */
function sumRow(row) {
  let t = 0;
  if (row) for (const c of Object.keys(row)) t += num(row[c], 0);
  return t;
}

/**
 * Inject each city's culture into its own tile, capped (field step 3). With foreignCultureInCities the cap bounds
 * the TOTAL culture on the tile and every other group present is pumped too (Civ V GetCityCulturalOutput).
 * @param {Map<string, *>} injectors Injectors by plot key. @param {*} field The OLD field.
 * @param {(k:string)=>Record<string, number>} rowOf Row accessor on the new field. @param {number} pace Age pace.
 * @param {{alive:Set<number>, comp:*}} ctx Living owners and the Emigration composition (or null).
 */
export function injectStep(injectors, field, rowOf, pace, ctx) {
  const foreign = !!CONFIG.foreignCultureInCities;
  for (const [k, inj] of injectors) {
    const old = field[k] || {};
    // Civ V capped the total culture on the city plot; without foreign groups that is the owner's own stock.
    const cap = cityCultureCap(inj.strength, CONFIG);
    const room = cap - (foreign ? sumRow(old) : (old[String(inj.civ)] || 0));
    const left = injectOwner(inj, old, rowOf(k), pace, room);
    if (foreign && left > 0) injectForeignGroups({ k, inj, old, row: rowOf(k), pace, room: left, ctx });
  }
}

/**
 * The owner's own injection into its city tile (self-amplifying, bounded by the room under the cap).
 * @returns {number} Room left under the cap.
 */
function injectOwner(inj, old, row, pace, room) {
  const civ = String(inj.civ);
  const currentOwn = old[civ] || 0;
  if (room <= 0) {
    if (!(row[civ] > 0)) row[civ] = currentOwn; // at the cap: carry the stock, add nothing
    return 0;
  }
  // pace scales the per-turn injected amount too (cap itself is unpaced), so the city stock builds toward the
  // same equilibrium, just re-timed to the age length.
  const add = Math.min(room, injectionAmount(inj.strength, currentOwn, CONFIG) * pace);
  if (add <= 0) return room;
  row[civ] = (row[civ] || 0) + add;
  return room - add;
}

/**
 * A foreign group's injection strength on a city tile, or 0 when the group is not pumped: with the Emigration
 * composition, the city's population times that group's share of it; without, full population strength for any
 * group holding at least foreignGroupMinStock, so a mere trickle of a neighbor's culture is never amplified.
 * @param {*} entry The Emigration composition entry for the city, or null. @param {number} pid The group's civ.
 * @param {number} stock The group's stock on the tile. @param {number} base population x foreignInjectScale.
 * @returns {number} Injection strength (0 = skip).
 */
function foreignStrength(entry, pid, stock, base) {
  if (entry) return base * shareOfCiv(entry, pid);
  return stock >= Math.max(0, num(CONFIG.foreignGroupMinStock, 0)) ? base : 0;
}

/**
 * Pump every FOREIGN culture group present on a city tile (Civ V: population x sqrt(stock x ratio) + base), inside
 * the room left under the tile's total cap. A dead civilization's culture is not pumped by anyone.
 * @param {{k:string, inj:*, old:Record<string,number>, row:Record<string,number>, pace:number, room:number, ctx:*}} a
 *   The tile: key, injector, old row, new row, age pace, room under the cap, and the pass context.
 * @returns {number} Room left under the cap.
 */
function injectForeignGroups(a) {
  const { k, inj, old, row, pace, ctx } = a;
  let room = a.room;
  const base = Math.max(0, num(inj.population, 0)) * Math.max(0, num(CONFIG.foreignInjectScale, 1));
  if (base <= 0) return room;
  const group = { ownerKey: String(inj.civ), entry: ctx.comp ? ctx.comp.get(k) : null, base, alive: ctx.alive };
  for (const civ of Object.keys(old)) {
    if (room <= 0) break;
    const strength = groupStrength(civ, old[civ] || 0, group);
    if (strength <= 0) continue;
    const add = Math.min(room, injectionAmount(strength, old[civ], CONFIG) * pace);
    if (add > 0) { row[civ] = (row[civ] || 0) + add; room -= add; }
  }
  return room;
}

/** A group's injection strength on the tile, or 0 when it is the owner, empty, dead, or not pumped here. */
function groupStrength(civ, stock, g) {
  if (civ === g.ownerKey || stock <= 0) return 0;
  const pid = parseInt(civ, 10);
  if (!g.alive.has(pid)) return 0;
  return foreignStrength(g.entry, pid, stock, g.base);
}

/**
 * Convert a share of every foreign group's stock on each city tile to the city's owner (Civ V ConvertCulture): the
 * base rate plus the city's buildings and its owner's traditions and ideology (cd-conversion.js).
 * @param {Map<string, *>} injectors Injectors by plot key.
 * @param {(k:string)=>Record<string, number>} rowOf Row accessor on the new field.
 * @returns {number} Culture converted this pass, summed over cities.
 */
export function convertStep(injectors, rowOf) {
  if (!CONFIG.foreignCultureInCities) return 0;
  let moved = 0;
  for (const [k, inj] of injectors) {
    const row = rowOf(k);
    const ownerKey = String(inj.civ);
    if (!Object.keys(row).some((c) => c !== ownerKey && row[c] > 0)) continue;
    moved += convertCityCulture(row, inj.civ, conversionRate(inj.city, inj.civ, CONFIG));
  }
  return moved;
}

/**
 * Keep at least `ownerFloor` of the owner's culture on every owned tile in the region (Civ V
 * MINIMAL_CULTURE_ON_OWNED_PLOT), so owned land never reads as having no culture at all.
 * @param {Set<string>} region Region plot keys. @param {Record<string, Record<string, number>>} next The new field.
 * @param {Set<number>} alive Players with living settlements (a dead pseudo-owner's plots are left alone).
 */
export function ownerFloorStep(region, next, alive) {
  const floor = Math.max(0, num(CONFIG.ownerFloor, 0));
  if (!(floor > 0)) return;
  for (const k of region) {
    const o = ownerAt(unkey(k));
    if (o < 0 || !alive.has(o)) continue;
    const row = next[k] || (next[k] = {});
    if (!(row[String(o)] >= floor)) row[String(o)] = floor;
  }
}
