// cd-city-flip-rule.js
//
// The rule for whole-settlement flips (mod_ideas_tested/liberation/cd-city-flip/SPEC.md §4), as pure functions over
// values the caller has read: whose culture leads the center, whether it has clearly won the center and enough of the
// settlement's plots, which gate holds the settlement, and the per-settlement hold counter. No engine reads and no
// imports, so it runs in Node as it runs in the game. cd-city-flip.js reads the map and drives the flip.
//
// The settlement path has its own gates and none of the tile path's (cd-eligibility, cd-borders' core protection,
// cd-teardown's refusal, cd-flip's cap): a whole settlement is never a tile flip.

/** Every flip marker's type starts with this; the leader's LeaderType follows. */
export const MARKER_PREFIX = "BUILDING_CD_FLIP_";

/** @param {string} leaderType e.g. "LEADER_PERICLES" @returns {string} The marker that hands a city to that leader. */
export function markerFor(leaderType) {
  return MARKER_PREFIX + String(leaderType || "");
}

/** @param {*} type A constructible type name. @returns {boolean} Whether it's one of this mod's flip markers. */
export function isFlipMarker(type) {
  return typeof type === "string" && type.indexOf(MARKER_PREFIX) === 0;
}

/** @param {*} v @param {number} [d] @returns {number} */
function num(v, d = 0) {
  return typeof v === "number" && isFinite(v) ? v : d;
}

/**
 * The strongest living culture on a tile.
 * @param {Record<string, number>|undefined} row civId -> stock.
 * @param {number[]} dead Civ ids to ignore.
 * @returns {{leader:number, value:number}} leader -1 when the tile holds no living culture.
 */
export function strongestOn(row, dead) {
  let leader = -1;
  let value = 0;
  if (!row) return { leader, value };
  for (const civ of Object.keys(row)) {
    const pid = parseInt(civ, 10);
    if (!isFinite(pid) || (dead && dead.indexOf(pid) >= 0)) continue;
    const v = num(row[civ]);
    if (v > value) { value = v; leader = pid; }
  }
  return { leader, value };
}

/**
 * Whether the leader has clearly won the center: its stock x cityFlipRatio beats the owner's (0.5 = twice the
 * owner), and it passes the age's ownership bar x cityFlipBar.
 * @param {Record<string, number>|undefined} row The center's field row.
 * @param {number} leader Leading civ. @param {number} owner The settlement's owner.
 * @param {{minimumOwner:number, cityFlipRatio:number, cityFlipBar:number}} cfg Age-adjusted config.
 * @returns {boolean}
 */
export function centreWon(row, leader, owner, cfg) {
  if (!row || leader < 0 || leader === owner) return false;
  const lead = num(row[String(leader)]);
  const own = num(row[String(owner)]);
  const ratio = Math.max(0, num(cfg.cityFlipRatio, 0.5));
  const bar = Math.max(0, num(cfg.minimumOwner, 300)) * Math.max(0, num(cfg.cityFlipBar, 2));
  return lead * ratio > own && lead > bar;
}

/**
 * The share of a settlement's plots where `leader` is the strongest living culture. A plot the field never reached
 * counts as not led.
 * @param {(Record<string, number>|undefined)[]} rows One field row per plot of the settlement, center included.
 * @param {number} leader Leading civ. @param {number[]} dead Civ ids to ignore.
 * @returns {number} In [0,1]; 0 for a settlement with no plots.
 */
export function plotShareLed(rows, leader, dead) {
  if (!rows || !rows.length) return 0;
  let led = 0;
  for (const row of rows) if (strongestOn(row, dead).leader === leader) led++;
  return led / rows.length;
}

/**
 * @typedef {Object} SettlementFacts What the caller read about one settlement and its center's leader.
 * @property {number} owner The settlement's owner.
 * @property {number} leader The strongest living culture on the center (-1 = none).
 * @property {boolean} ownerMajor The owner is an alive major civ.
 * @property {boolean} leaderMajor The leader is an alive major civ.
 * @property {boolean} sameTeam Owner and leader share a team (the engine's guard refuses the transfer).
 * @property {boolean} atWar Owner and leader are at war.
 * @property {boolean} isCapital The settlement is its owner's capital.
 * @property {number} ownerSettlements How many settlements the owner has.
 * @property {boolean} distantLands The center is in the leader's distant lands and the age is Antiquity.
 * @property {boolean} paused An age-transition window is open.
 * @property {boolean} multiplayer This is a network game.
 */

/**
 * Why a settlement can't flip to its center's leader right now, or null when only culture decides. These are the
 * settlement path's only gates (SPEC §4); none of the tile gates apply.
 * @param {SettlementFacts} f Facts.
 * @param {{cityFlips:boolean, cityFlipCapitals:boolean, cityFlipEliminates:boolean}} cfg Live config.
 * @returns {string|null} A short reason code.
 */
export function cityFlipRefusal(f, cfg) {
  for (const [code, holds] of GATES) if (holds(f, cfg)) return code;
  return null;
}

/** The gates in the order they're asked; the first that holds names the reason. */
const GATES = Object.freeze([
  ["off", (_f, c) => !c.cityFlips],
  ["multiplayer", (f) => !!f.multiplayer],
  ["age-transition", (f) => !!f.paused],
  ["not-major", (f) => !f.ownerMajor],
  ["no-leader", (f) => f.leader < 0],
  ["owner-leads", (f) => f.leader === f.owner],
  ["not-major", (f) => !f.leaderMajor],
  ["same-team", (f) => !!f.sameTeam],
  ["at-war", (f) => !!f.atWar],
  ["capital", (f, c) => !!f.isCapital && !c.cityFlipCapitals],
  ["last-settlement", (f, c) => f.ownerSettlements <= 1 && !c.cityFlipEliminates],
  ["distant-lands", (f) => !!f.distantLands]
]);

/**
 * Advance one settlement's hold counter. A pass the leader has clearly won counts up; a pass it hasn't, or a change
 * of leader or owner, starts over.
 * @param {{by:number, owner:number, n:number}|undefined|null} prev The counter so far.
 * @param {number} leader This pass's leader. @param {number} owner This pass's owner.
 * @param {boolean} won Whether the leader won the center and the plots this pass (and no gate holds it).
 * @returns {{by:number, owner:number, n:number}|null} The new counter, or null when it resets.
 */
export function nextHold(prev, leader, owner, won) {
  if (!won) return null;
  const same = prev && prev.by === leader && prev.owner === owner;
  return { by: leader, owner, n: same ? prev.n + 1 : 1 };
}

/** @param {{n:number}|null|undefined} hold @param {{cityFlipHoldPasses:number}} cfg @returns {boolean} */
export function flipDue(hold, cfg) {
  return !!hold && hold.n >= Math.max(1, Math.floor(num(cfg.cityFlipHoldPasses, 3)));
}

/**
 * The settlements to flip this pass: those due, longest held first, then the strongest lead, at most
 * maxCityFlipsPerPass.
 * @template {{hold:{n:number}, lead:number}} T
 * @param {T[]} due Settlements whose hold has reached cityFlipHoldPasses.
 * @param {{maxCityFlipsPerPass:number}} cfg Live config.
 * @returns {T[]} The ones to flip now.
 */
export function pickFlips(due, cfg) {
  const cap = Math.max(0, Math.floor(num(cfg.maxCityFlipsPerPass, 1)));
  return due.slice().sort((a, b) => (b.hold.n - a.hold.n) || (b.lead - a.lead)).slice(0, cap);
}
