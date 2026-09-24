// tests/lens-parity.mjs - the lens/tooltip must promise exactly what the pass delivers.
//
// This does NOT test the lens in isolation. It drives the SAME fixture through both `pressureTiles()` and
// `runPass()` and asserts they agree, tile by tile, for every gate in turn. That invariant is the point:
// "the lens paints a tile IF AND ONLY IF the pass would take it" cannot rot even when both sides change,
// whereas a test of the lens's own logic would just re-encode today's rules twice.
//
// It exists because the drift was real and long-lived. `passCanAct` was shared, so the lens knew whose
// culture led - but every other gate lived privately inside the pass, so the overlay tinted, and the hover
// readout counted down turns on, tiles the pass would never take: a rival's protected core, a war front, a
// tile out of range or on cooldown. Adding the minor-settlement floor made it worse, because a city-state's
// ring-1 would show progress that never resolves. All of it now goes through cd-eligibility.js.
//
// SCOPE / HONEST LIMIT: this proves the two agree about WHICH tiles. It cannot prove the overlay renders -
// painting goes through WorldUI, which no off-engine test reaches. A lens run in the harness covers that.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

// --- engine stub (same shape as tests/pass.mjs) ----------------------------------
const tiles = new Map();
const water = new Set();
const units = new Map();          // "x,y" -> [{owner, type}]
const centresOnMap = new Set();
const minorPlayers = new Set();
const extraAlive = [];
let savedState = null;
let atWarWith = new Set();
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const getTile = (x, y) => tiles.get(tk(x, y)) || { owner: -1, city: -1 };
function getTileMut(x, y) {
  if (!tiles.has(tk(x, y))) tiles.set(tk(x, y), { owner: -1, city: -1 });
  return tiles.get(tk(x, y));
}

const ME = 0, RIVAL = 3, MINOR = 18;
const CITY_ID = 42;
const CENTER = { x: 10, y: 10 };

globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameContext = { localPlayerID: ME };
globalThis.YieldTypes = { YIELD_CULTURE: 1, YIELD_HAPPINESS: 2, YIELD_FOOD: 3, YIELD_PRODUCTION: 4, YIELD_GOLD: 5, YIELD_SCIENCE: 6 };
globalThis.Configuration = {
  getGame: () => ({ isAnyMultiplayer: false, getValue: () => (savedState ? JSON.stringify({ v: 2, data: savedState }) : null) }),
  editGame: () => ({ setValue: (_k, v) => { savedState = JSON.parse(v).data; } })
};
globalThis.GameplayMap = {
  getOwner: (x, y) => getTile(x, y).owner,
  getOwningCityFromXY: (x, y) => ({ id: getTile(x, y).city }),
  isWater: (x, y) => water.has(tk(x, y)),
  isImpassable: () => false,
  getGridWidth: () => 200, getGridHeight: () => 200,
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  },
  getLocationFromIndex: (i) => dec(i)
};
globalThis.Cities = { getAtLocation: (x, y) => (centresOnMap.has(tk(x, y)) ? { id: 55 } : null), get: () => null };
globalThis.MapUnits = { getUnits: (x, y) => (units.get(tk(x, y)) || []).map((_u, i) => ({ x, y, i })) };
globalThis.Units = { get: (cid) => (units.get(tk(cid.x, cid.y)) || [])[cid.i] };
globalThis.GameInfo = { Units: { lookup: (t) => ({ Domain: t === "SEA" ? "DOMAIN_SEA" : "DOMAIN_LAND" }) } };
globalThis.WorldBuilder = { MapPlots: { setOwnership: () => {} } };

function makeCity(id, location, owner, culture) {
  return {
    id, location, owner,
    Yields: { getNetYield: (e) => (e === YieldTypes.YIELD_CULTURE ? culture : 2) },
    Happiness: { netHappinessPerTurn: 4, isInGoldenAge: () => false },
    Constructibles: { getNumWonders: () => 0 },
    purchasePlot: (loc) => { const t = getTileMut(loc.x, loc.y); t.owner = owner; t.city = id; }
  };
}
let myCity = makeCity(CITY_ID, CENTER, ME, 40);
let rivalCity = makeCity(77, { x: 22, y: 10 }, RIVAL, 30);
globalThis.Players = {
  getAlive: () => [
    { id: ME, isAlive: true, isMajor: true, Cities: { getCities: () => [myCity] } },
    { id: RIVAL, isAlive: true, isMajor: true, Cities: { getCities: () => [rivalCity] } },
    ...extraAlive
  ],
  get: (pid) => ({
    id: pid,
    isMajor: !minorPlayers.has(pid),
    Treasury: { goldBalance: 100000, changeGoldBalance: () => {} },
    Happiness: { isInGoldenAge: () => false },
    Diplomacy: { isAtWarWith: (o) => atWarWith.has(o) },
    isDistantLands: () => false
  })
};
globalThis.Game = { age: "AGE_ANTIQUITY", turn: 10, maxTurns: 90 };
globalThis.WorldUI = { addPlots: () => {}, clearPlots: () => {} };
// The settings store both sides read. applyTunableOverrides() pulls these into CONFIG, so a fixture that
// wants a SETTINGS-driven knob (diffusionEnabled, claimOnlyUnowned, fusedModel, preset keys) must set it
// here - writing CONFIG directly is clobbered the moment the lens reads, which is exactly how the first
// draft of this suite created a state the game cannot be in.
const modSettings = { "cultural-diffusion": {} };
globalThis.localStorage = {
  getItem: (k) => (k === "modSettings" ? JSON.stringify(modSettings) : null),
  setItem: () => {}, removeItem: () => {}, clear: () => {}
};
function setSetting(key, value) { modSettings["cultural-diffusion"][key] = value ? 1 : 0; }
function clearSettings() { modSettings["cultural-diffusion"] = {}; }

const { runPass } = await import("/cultural-diffusion/ui/cd-pass.js");
const { __test: LensT } = await import("/cultural-diffusion/ui/cd-pressure-lens.js");
const { __test: TipT } = await import("/cultural-diffusion/ui/cd-pressure-tooltip.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");

CONFIG.diffusionEnabled = true;
CONFIG.fusedModel = false;
CONFIG.calibrateToGameSettings = false;
CONFIG.growthBuffer = false;
CONFIG.repairOrphans = false;
CONFIG.recedeBorders = false;
CONFIG.baseGrowthRadius = 3;
CONFIG.fieldRadius = 8;
CONFIG.flipVerb = "purchasePlot";
CONFIG.claimOnlyUnowned = false;
CONFIG.requireAdjacency = true;
CONFIG.coreProtectRadius = 0;
CONFIG.minorProtectRadius = 1;
CONFIG.protectTrappedUnits = true;
CONFIG.maxFlipsPerTurn = 8;
CONFIG.maxDiffusionPlots = 80;
CONFIG.flipMaxDistance = 6;
CONFIG.flipCooldownTurns = 15;
CONFIG.minimumOwner = 300;
CONFIG.debug = false;

const TARGET = { x: 14, y: 10 };          // ring-4: the eligible frontier tile
const TK = tk(TARGET.x, TARGET.y);

/** Own rings 0..3 around CENTER; everything else empty. */
function reset() {
  tiles.clear(); water.clear(); units.clear(); centresOnMap.clear(); minorPlayers.clear();
  extraAlive.length = 0; atWarWith = new Set(); savedState = null; clearSettings();
  myCity = makeCity(CITY_ID, CENTER, ME, 40);
  rivalCity = makeCity(77, { x: 22, y: 10 }, RIVAL, 30);
  for (let y = 0; y <= 20; y++) for (let x = 0; x <= 20; x++) {
    if (hexDistance(CENTER, { x, y }) <= CONFIG.baseGrowthRadius) {
      const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID;
    }
  }
}
const mature = () => ({ [String(ME)]: 5000 });
function seed(extra) { savedState = { field: {}, claims: {}, locked: {}, pending: {}, monoTurn: 5, ...extra }; }

/** Does the lens paint this tile? */
function painted(loc) {
  return LensT.pressureTiles().some((t) => t.x === loc.x && t.y === loc.y);
}
/** Does the hover readout offer capture-progress rows for this tile? */
function tipShowsProgress(loc) {
  TipT.clearSnapshot();   // the readout caches its field+context for FIELD_TTL; pin the fresh answer
  const out = TipT.resolve(loc);
  return !!(out && out.rows.some((r) => typeof r.value === "string" && /%$/.test(r.value)));
}

// Knobs a fixture sets. Reading the LENS calls applyTunableOverrides(), which pulls saved settings into the
// shared CONFIG - in game the lens runs in the HUD isolate with its own copy, but in one test process it
// clobbers the fixture. So snapshot these around the lens/tooltip reads.
const KNOBS = ["claimOnlyUnowned", "requireAdjacency", "coreProtectRadius", "minorProtectRadius",
  "protectTrappedUnits", "flipMaxDistance", "baseGrowthRadius", "maxDiffusionPlots", "maxFlipsPerTurn",
  "flipCooldownTurns", "minimumOwner", "recedeBorders", "growthBuffer", "repairOrphans", "fusedModel",
  "calibrateToGameSettings", "diffusionEnabled"];
function snapKnobs() { const o = {}; for (const k of KNOBS) o[k] = CONFIG[k]; return o; }
function restoreKnobs(o) { for (const k of KNOBS) CONFIG[k] = o[k]; }

/**
 * The invariant. Read the lens and the tooltip FIRST (the pass mutates ownership), then run the pass, and
 * require all three to agree about this tile.
 */
function assertParity(label, loc, expectFlip) {
  const knobs = snapKnobs();
  const lens = painted(loc);
  const tip = tipShowsProgress(loc);
  restoreKnobs(knobs);
  const r = runPass();
  const flipped = getTile(loc.x, loc.y).owner === ME || (r.pending > 0 && savedState.pending[tk(loc.x, loc.y)]);
  assert.equal(!!flipped, expectFlip, `${label}: the pass ${expectFlip ? "must" : "must not"} take the tile`);
  assert.equal(lens, expectFlip, `${label}: the lens must ${expectFlip ? "paint" : "NOT paint"} it (pass=${!!flipped})`);
  assert.equal(tip, expectFlip, `${label}: the readout must ${expectFlip ? "show" : "NOT show"} progress (pass=${!!flipped})`);
}

// 1. The baseline: an eligible frontier tile. Both act.
reset(); seed({ field: { [TK]: mature() } });
assertParity("eligible ring-4 tile", TARGET, true);

// 2. Beyond flipMaxDistance.
reset();
const FAR = { x: 17, y: 10 };
assert.equal(hexDistance(CENTER, FAR), 7, "fixture: FAR is ring-7, beyond flipMaxDistance 6");
for (let x = 11; x <= 16; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; } // reach it
seed({ field: { [tk(FAR.x, FAR.y)]: mature() } });
assertParity("beyond flipMaxDistance", FAR, false);

// 3. requireAdjacency: in range, but our land does not touch it.
reset(); seed({ field: { [tk(15, 10)]: mature() } });
assertParity("not adjacent to our land", { x: 15, y: 10 }, false);

// 4. A rival's protected city centre.
reset();
const RIVAL_CORE = { x: 16, y: 10 };
rivalCity = makeCity(99, RIVAL_CORE, RIVAL, 10);
const rc = getTileMut(RIVAL_CORE.x, RIVAL_CORE.y); rc.owner = RIVAL; rc.city = 99;
for (let x = 11; x <= 15; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; }
seed({ field: { [tk(RIVAL_CORE.x, RIVAL_CORE.y)]: { [String(ME)]: 5000, [String(RIVAL)]: 10 } } });
assertParity("a rival's protected core", RIVAL_CORE, false);

// 5. At war with the owner.
reset();
const RIVAL_TILE = { x: 14, y: 10 };
const rt = getTileMut(RIVAL_TILE.x, RIVAL_TILE.y); rt.owner = RIVAL; rt.city = 77;
atWarWith = new Set([RIVAL]);
seed({ field: { [tk(RIVAL_TILE.x, RIVAL_TILE.y)]: { [String(ME)]: 5000, [String(RIVAL)]: 10 } } });
assertParity("at war with the owner", RIVAL_TILE, false);

// 6. A MINOR's ring-1, protected by minorProtectRadius.
reset();
const MINOR_CENTRE = { x: 16, y: 10 };
const MINOR_RING1 = { x: 15, y: 10 };
minorPlayers.add(MINOR);
const minorCity = makeCity(97, MINOR_CENTRE, MINOR, 10);
extraAlive.push({ id: MINOR, isAlive: true, isMajor: false, Cities: { getCities: () => [minorCity] } });
for (const p of [MINOR_CENTRE, MINOR_RING1]) { const t = getTileMut(p.x, p.y); t.owner = MINOR; t.city = 97; }
for (let x = 11; x <= 14; x++) { const t = getTileMut(x, 10); t.owner = ME; t.city = CITY_ID; }
seed({ field: { [tk(MINOR_RING1.x, MINOR_RING1.y)]: { [String(ME)]: 5000, [String(MINOR)]: 10 } } });
assertParity("a minor settlement's ring-1", MINOR_RING1, false);

// 7. Cooldown lock.
reset(); seed({ field: { [TK]: mature() }, locked: { [TK]: 5 } });
assertParity("a tile on flip cooldown", TARGET, false);

// 8. Safety mode: owned land is off limits.
reset();
const OWNED = { x: 14, y: 10 };
const ot = getTileMut(OWNED.x, OWNED.y); ot.owner = RIVAL; ot.city = 77;
setSetting("claimOnlyUnowned", true);   // the SETTING, so both the pass and the lens see it
CONFIG.claimOnlyUnowned = true;
seed({ field: { [tk(OWNED.x, OWNED.y)]: { [String(ME)]: 5000, [String(RIVAL)]: 10 } } });
assertParity("claimOnlyUnowned with an owned tile", OWNED, false);
clearSettings();
CONFIG.claimOnlyUnowned = false;

// 9. The strand guard: this claim would take a peaceful civ's last legal destination.
reset();
const PEN = { x: 15, y: 10 };            // the unit sits here; TARGET is its only way out
// Compute the six neighbours rather than listing them: on an odd-r hex grid the diagonals shift per row, and
// a hand-written ring left this unit two exits the guard was right to respect.
for (let y = PEN.y - 1; y <= PEN.y + 1; y++) {
  for (let x = PEN.x - 1; x <= PEN.x + 1; x++) {
    if (hexDistance(PEN, { x, y }) !== 1) continue;
    if (x === TARGET.x && y === TARGET.y) continue;   // leave exactly one way out
    const t = getTileMut(x, y); t.owner = ME; t.city = CITY_ID;
  }
}
units.set(tk(PEN.x, PEN.y), [{ owner: RIVAL, type: "LAND" }]);
seed({ field: { [TK]: mature() } });
assertParity("a claim that would strand a unit", TARGET, false);

// 10. ...and once the unit has gone, the same tile is taken and painted again.
reset(); seed({ field: { [TK]: mature() } });
assertParity("the same tile after the unit moves on", TARGET, true);

console.log("lens-parity.mjs OK");
