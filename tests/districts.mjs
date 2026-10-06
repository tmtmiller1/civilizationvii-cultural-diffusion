// tests/districts.mjs: the district read behind conquest's "never an urban district" rule (cd-plots.js).
//
// Game 1.5.0 has no GameplayMap.getDistrictType (watched 2026-10-05, harness valuable2): every plot read as no
// district, so conquerable() let urban districts through, against README "City centers and urban districts are
// never taken this way". The read that works there is Districts.getAtLocation(loc).type against DistrictTypes.
import assert from "node:assert/strict";

const districts = new Map(); // "x,y" -> DistrictTypes value
globalThis.DistrictTypes = { CITY_CENTER: 10, URBAN: 11, RURAL: 12, WILDERNESS: 13 };
globalThis.Districts = { getAtLocation: (loc) => (districts.has(`${loc.x},${loc.y}`) ? { type: districts.get(`${loc.x},${loc.y}`) } : null) };
globalThis.GameplayMap = { getOwner: () => 1, getOwningCityFromXY: () => null };
globalThis.Cities = { getAtLocation: () => null, get: () => null };
globalThis.Players = { get: (id) => (id === 1 ? { id: 1, isMajor: true, isAlive: true } : null) };

const { districtTypeNameAt, isCityCenterAt } = await import("/cultural-diffusion/ui/cd-plots.js");
const { conquerable } = await import("/cultural-diffusion/ui/cd-conquest.js");

districts.set("5,5", DistrictTypes.URBAN);
districts.set("6,5", DistrictTypes.RURAL);
districts.set("7,5", DistrictTypes.CITY_CENTER);
districts.set("8,5", DistrictTypes.WILDERNESS);

// 1. The 1.5.0 shape: no getDistrictType, Districts.getAtLocation answers.
assert.equal(typeof GameplayMap.getDistrictType, "undefined");
assert.equal(districtTypeNameAt({ x: 5, y: 5 }), "DISTRICT_URBAN");
assert.equal(districtTypeNameAt({ x: 6, y: 5 }), "DISTRICT_RURAL");
assert.equal(districtTypeNameAt({ x: 9, y: 5 }), null, "no district on the plot");
assert.equal(isCityCenterAt({ x: 7, y: 5 }), true, "the third city-center route works again");

// 2. Conquest refuses urban districts and city centers, and takes rural and wilderness tiles.
assert.equal(conquerable({ x: 5, y: 5 }, 1), false, "urban district");
assert.equal(conquerable({ x: 7, y: 5 }, 1), false, "city center");
assert.equal(conquerable({ x: 6, y: 5 }, 1), true, "rural");
assert.equal(conquerable({ x: 8, y: 5 }, 1), true, "wilderness");
assert.equal(conquerable({ x: 9, y: 5 }, 1), true, "no district");

// 3. A build that does have getDistrictType keeps using it first.
GameplayMap.getDistrictType = (x, y) => (x === 6 && y === 5 ? 99 : null);
globalThis.GameInfo = { Districts: { lookup: (t) => (t === 99 ? { DistrictType: "DISTRICT_URBAN" } : null) } };
assert.equal(districtTypeNameAt({ x: 6, y: 5 }), "DISTRICT_URBAN", "getDistrictType wins when present");
assert.equal(districtTypeNameAt({ x: 5, y: 5 }), "DISTRICT_URBAN", "falls through to Districts when it returns null");

// 4. Neither API: null, never a throw.
delete GameplayMap.getDistrictType;
const saved = globalThis.Districts;
delete globalThis.Districts;
assert.equal(districtTypeNameAt({ x: 5, y: 5 }), null);
globalThis.Districts = saved;

console.log("districts.mjs OK");
