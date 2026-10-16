// tests/borders.mjs: core protection's settlement-center reads, inside and outside a sweep.
//
// isCoreProtected runs for every rival tile the pass, the AI flips and the lens consider. Each call used to
// walk every living player's city list and read every plot of the ring off the map. withCentreCache (cd-borders.js)
// reads the centers once per sweep instead. This pins two things: the answers are the same with and without the
// cache, and inside a sweep the engine reads happen once, not once per tile.
import assert from "node:assert/strict";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });
const tk = (x, y) => `${x},${y}`;

const MAJOR = 3, VILLAGE_OWNER = 20;
const MAJOR_CENTRE = { x: 10, y: 10 };
const VILLAGE = { x: 20, y: 10 };          // a center only the map reports (an Independent Power lists no cities)
const owners = new Map([[tk(MAJOR_CENTRE.x, MAJOR_CENTRE.y), MAJOR], [tk(VILLAGE.x, VILLAGE.y), VILLAGE_OWNER]]);
// The major's ring-1 and ring-2 tiles are its territory: Cities.getAtLocation answers with the major's city for all
// of them (the engine returns the OWNING city for any plot it owns, watched 2026-10-16), and only its location says
// which plot is the centre.
for (let y = MAJOR_CENTRE.y - 2; y <= MAJOR_CENTRE.y + 2; y++) for (let x = MAJOR_CENTRE.x - 2; x <= MAJOR_CENTRE.x + 2; x++) {
  if (hexDistance(MAJOR_CENTRE, { x, y }) <= 2) owners.set(tk(x, y), MAJOR);
}
const MAJOR_CITY = { id: 1, location: MAJOR_CENTRE };
const reads = { getAlive: 0, getAtLocation: 0 };

globalThis.GameplayMap = {
  getOwner: (x, y) => owners.get(tk(x, y)) ?? -1,
  getOwningCityFromXY: () => null,
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  },
  getLocationFromIndex: (i) => dec(i)
};
globalThis.Players = {
  getAlive: () => {
    reads.getAlive++;
    return [{ id: MAJOR, isAlive: true, Cities: { getCities: () => [{ id: 1, location: MAJOR_CENTRE }] } }];
  },
  get: () => null
};
globalThis.Cities = {
  getAtLocation: (loc) => {
    reads.getAtLocation++;
    const k = tk(loc.x, loc.y);
    if (k === tk(VILLAGE.x, VILLAGE.y)) return { id: 9, location: VILLAGE };
    return owners.get(k) === MAJOR ? MAJOR_CITY : null;
  },
  get: () => null
};

const { isCoreProtected, withCentreCache } = await import("/cultural-diffusion/ui/cd-borders.js");

// Every plot within three rings of either center, asked for every owner filter and radius.
const plots = [];
for (const c of [MAJOR_CENTRE, VILLAGE]) {
  for (let y = c.y - 3; y <= c.y + 3; y++) for (let x = c.x - 3; x <= c.x + 3; x++) {
    if (hexDistance(c, { x, y }) <= 3) plots.push({ x, y });
  }
}
const asks = [];
for (const p of plots) for (const owner of [-1, MAJOR, VILLAGE_OWNER, 7]) for (const r of [-1, 0, 1, 2]) asks.push([p, owner, r]);

// 1. The answers, uncached.
const plain = asks.map(([p, o, r]) => isCoreProtected(p, o, r));
const plainReads = { ...reads };
assert.ok(plainReads.getAlive >= asks.length / 2, "fixture: uncached, the city lists are walked on every ask");

// Sanity on the answers themselves.
const ask = (p, o, r) => plain[asks.findIndex(([q, oo, rr]) => q.x === p.x && q.y === p.y && oo === o && rr === r)];
assert.equal(ask(MAJOR_CENTRE, MAJOR, 0), true, "a major's center is protected at radius 0");
assert.equal(ask({ x: 11, y: 10 }, MAJOR, 0), false, "its ring-1 isn't at radius 0");
assert.equal(ask({ x: 11, y: 10 }, MAJOR, 1), true, "its ring-1 is at radius 1");
assert.equal(ask({ x: 11, y: 10 }, 7, 1), false, "another owner's filter doesn't see it");
assert.equal(ask({ x: 12, y: 10 }, MAJOR, 1), false, "an owned ring-2 tile isn't a centre: the map returns the owning city for it, but the city stands elsewhere (1.6.0 refused every owned tile here)");
assert.equal(ask({ x: 13, y: 10 }, MAJOR, 0), false, "radius 0 and an owned ring-3 tile: not protected");
assert.equal(ask({ x: 21, y: 10 }, VILLAGE_OWNER, 1), true, "the village, which no city list reports, is protected");
assert.equal(ask(MAJOR_CENTRE, -1, -1), false, "radius -1 protects nothing");

// 2. The same answers inside a sweep, with the engine read once.
reads.getAlive = 0; reads.getAtLocation = 0;
const cached = withCentreCache(() => asks.map(([p, o, r]) => isCoreProtected(p, o, r)));
assert.deepEqual(cached, plain, "the cache changes no answer");
assert.equal(reads.getAlive, 1, "inside a sweep the city lists are walked once");
// Every plot any ask can reach: within radius 2 of an asked plot.
const reach = new Set();
for (const p of plots) {
  for (let y = p.y - 2; y <= p.y + 2; y++) for (let x = p.x - 2; x <= p.x + 2; x++) {
    if (hexDistance(p, { x, y }) <= 2) reach.add(tk(x, y));
  }
}
assert.ok(reads.getAtLocation <= reach.size, `each plot is read off the map at most once (${reads.getAtLocation} reads)`);
assert.ok(plainReads.getAtLocation > reach.size * 2, "fixture: uncached, the same plots are read many times over");

// 3. Nothing leaks out of a sweep: a city founded afterwards is seen at once.
reads.getAlive = 0;
isCoreProtected(MAJOR_CENTRE, MAJOR, 0);
isCoreProtected(MAJOR_CENTRE, MAJOR, 0);
assert.equal(reads.getAlive, 2, "outside a sweep every ask reads the engine again");

// 4. A nested sweep shares the outer cache and leaves it in place for the rest of the outer sweep.
reads.getAlive = 0;
withCentreCache(() => {
  isCoreProtected(MAJOR_CENTRE, MAJOR, 0);
  withCentreCache(() => isCoreProtected(VILLAGE, VILLAGE_OWNER, 0));
  isCoreProtected({ x: 11, y: 10 }, MAJOR, 1);
});
assert.equal(reads.getAlive, 1, "one walk of the city lists for the outer sweep and everything nested in it");

// 5. A sweep that throws still ends the cache.
assert.throws(() => withCentreCache(() => { throw new Error("boom"); }));
reads.getAlive = 0;
isCoreProtected(MAJOR_CENTRE, MAJOR, 0);
isCoreProtected(MAJOR_CENTRE, MAJOR, 0);
assert.equal(reads.getAlive, 2, "after a sweep that threw, reads go to the engine again");

console.log("borders.mjs OK");
