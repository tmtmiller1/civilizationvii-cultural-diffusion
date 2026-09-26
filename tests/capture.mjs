// tests/capture.mjs - the CityTransfered handler (cd-capture.js) against a stubbed engine: it rewrites only the
// captured city's tiles, uses getPurchasedPlots when present and a radius scan when not, saves at once, and is a
// no-op when off or when the payload is unreadable. The arithmetic itself is pinned in tests/parity.mjs.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

let savedState = null;
let saves = 0;
const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const owningCity = new Map(); // "x,y" -> city id

globalThis.Configuration = {
  getGame: () => ({ getValue: () => (savedState ? JSON.stringify({ v: 2, data: savedState }) : null) }),
  editGame: () => ({ setValue: (_k, v) => { savedState = JSON.parse(v).data; saves++; } })
};
globalThis.GameplayMap = {
  getOwningCityFromXY: (x, y) => ({ id: owningCity.has(tk(x, y)) ? owningCity.get(tk(x, y)) : -1 }),
  getLocationFromIndex: (i) => dec(i),
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  }
};
const cities = new Map();
globalThis.Cities = { get: (cid) => cities.get(cid && cid.id) || null };

const { onCityTransfered, cityPlots } = await import("/cultural-diffusion/ui/cd-capture.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
CONFIG.captureTransfer = true; CONFIG.captureLoss = 0.55; CONFIG.captureGain = 0.75; CONFIG.fieldRadius = 8;

const CENTRE = { x: 10, y: 10 };
const A = { x: 11, y: 10 }, B = { x: 12, y: 10 }, FAR = { x: 30, y: 30 };
function seed() {
  savedState = { field: {
    [tk(CENTRE.x, CENTRE.y)]: { 3: 1000 }, [tk(A.x, A.y)]: { 3: 400, 0: 100 }, [tk(B.x, B.y)]: { 3: 200 },
    [tk(FAR.x, FAR.y)]: { 3: 500 }
  }, claims: {}, locked: {}, pending: {}, monoTurn: 7 };
  saves = 0;
}

// 1. With getPurchasedPlots: exactly the listed plots (centre added) are rewritten; the far tile is untouched.
seed();
cities.set(9, { id: 9, location: CENTRE, getPurchasedPlots: () => [enc(A.x, A.y), enc(B.x, B.y)] });
let n = onCityTransfered({ fromPlayer: 3, transferType: 1, cityID: { owner: 0, id: 9, type: 1 } });
assert.equal(n, 3, "centre + two purchased plots rewritten");
assert.equal(saves, 1, "saved at once");
const f = savedState.field;
assert.ok(Math.abs(f[tk(CENTRE.x, CENTRE.y)][3] - 450) < 1e-9 && Math.abs(f[tk(CENTRE.x, CENTRE.y)][0] - 412.5) < 1e-9,
  "centre: old owner keeps 45%, conqueror gains 75% of the 550 lost");
assert.ok(Math.abs(f[tk(A.x, A.y)][3] - 180) < 1e-9, "a purchased plot is rewritten");
assert.deepEqual(f[tk(FAR.x, FAR.y)], { 3: 500 }, "a tile of another city is untouched");

// 2. Without getPurchasedPlots: the radius scan by owning city finds the same plots.
seed();
cities.set(9, { id: 9, location: CENTRE });
owningCity.set(tk(A.x, A.y), 9); owningCity.set(tk(B.x, B.y), 9); owningCity.set(tk(CENTRE.x, CENTRE.y), 9);
assert.equal(cityPlots(cities.get(9)).length, 3, "fallback scan: centre + the two owned plots");
n = onCityTransfered({ fromPlayer: 3, cityID: { owner: 0, id: 9 } });
assert.equal(n, 3, "the fallback rewrites the same three tiles");

// 3. Off, unreadable, or outside the field: nothing happens and nothing is saved.
seed();
CONFIG.captureTransfer = false;
assert.equal(onCityTransfered({ cityID: { owner: 0, id: 9 } }), 0, "off: no-op");
CONFIG.captureTransfer = true;
assert.equal(onCityTransfered(null), 0, "no payload: no-op");
assert.equal(onCityTransfered({ cityID: { owner: 0, id: 404 } }), 0, "unknown city: no-op");
cities.set(10, { id: 10, location: { x: 60, y: 60 }, getPurchasedPlots: () => [] });
assert.equal(onCityTransfered({ cityID: { owner: 0, id: 10 } }), 0, "a city outside the field has no rows to rewrite");
assert.equal(saves, 0, "...and none of these saved");

console.log("capture.mjs OK");
