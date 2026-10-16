// tests/city-flip.mjs: whole-settlement flips (ui/cd-city-flip.js) against a stubbed engine. The pass step counts a
// won settlement up to the bar, warns on the first pass and picks it on the third; the gates hold it; the flip places
// the leader's marker, waits for the transfer, removes the marker, books every plot together, writes the grievances
// and sends the notice with Partisans' line. A transfer that never arrives leaves every plot as it was. A joined
// settlement's plots never count toward a claim cap and are never released to the base game.
//
// It also checks the settlement path stays clear of the tile path: neither the flip module nor the rule names a tile
// gate, and neither reaches the tile-flip modules through its imports.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hexDistance } from "/cultural-diffusion/ui/cd-pressure.js";

const tk = (x, y) => `${x},${y}`;
const enc = (x, y) => (y + 100) * 1000 + (x + 100);
const dec = (i) => ({ x: (i % 1000) - 100, y: Math.floor(i / 1000) - 100 });

// The stub world.
let savedState = null;
let multiplayer = false;
const owners = new Map(); // "x,y" -> owner
const requests = [];
const notifications = [];
const grievances = []; // { on: the player whose Diplomacy is written, target, n }
const logs = [];
const war = new Set(); // "a,b"
let onCreate = null; // what the engine does with a CREATE_ELEMENT

const ME = 0, RIVAL = 3, MINOR = 9;
/** @type {Map<number, *>} */
const players = new Map();
/** @type {Map<number, *>} */
const cities = new Map();

function makeCity(id, owner, at, plots, extra = {}) {
  const c = {
    id: { owner, id, type: 1 }, owner, location: at, name: `CITY_${id}`, isCapital: false,
    markers: [],
    getPurchasedPlots: () => plots.map((p) => enc(p.x, p.y)),
    Constructibles: { getIds: () => c.markers.map((m) => m.cid) },
    ...extra
  };
  cities.set(id, c);
  for (const p of plots) owners.set(tk(p.x, p.y), owner);
  return c;
}
function makePlayer(id, { major = true, team = id } = {}) {
  const p = {
    id, isAlive: true, isMajor: major, isMinor: !major, team, leaderType: 100 + id, civilizationName: `CIV_${id}`,
    isDistantLands: () => false,
    Cities: { getCities: () => [...cities.values()].filter((c) => c.owner === id) },
    Diplomacy: {
      isAtWarWith: (b) => war.has(`${id},${b}`) || war.has(`${b},${id}`),
      changeNumGrievances: (b, n) => grievances.push({ on: id, target: b, n })
    }
  };
  players.set(id, p);
  return p;
}

globalThis.GameContext = { localPlayerID: ME };
globalThis.Configuration = {
  getGame: () => ({
    get isAnyMultiplayer() { return multiplayer; },
    getValue: () => (savedState ? JSON.stringify({ v: 2, data: savedState }) : null)
  }),
  editGame: () => ({ setValue: (_k, v) => { savedState = JSON.parse(v).data; } })
};
globalThis.GameplayMap = {
  getOwner: (x, y) => (owners.has(tk(x, y)) ? owners.get(tk(x, y)) : -1),
  getOwningCityFromXY: () => ({ id: -1 }),
  getPlotIndicesInRadius: (cx, cy, r) => {
    const out = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) if (hexDistance({ x: cx, y: cy }, { x, y }) <= r) out.push(enc(x, y));
    }
    return out;
  },
  getLocationFromIndex: (i) => dec(i)
};
globalThis.Players = { getAlive: () => [...players.values()], get: (id) => players.get(id) || null };
globalThis.Cities = { get: (cid) => cities.get(cid && cid.id) || null };
const MARKER_INDEX = 500;
globalThis.GameInfo = {
  Leaders: { lookup: (h) => ({ LeaderType: `LEADER_P${h - 100}` }) },
  Constructibles: {
    lookup: (t) => {
      if (t === MARKER_INDEX) return { ConstructibleType: "BUILDING_CD_FLIP_LEADER_P0" };
      return typeof t === "string" && t.startsWith("BUILDING_CD_FLIP_") ? { ConstructibleType: t } : null;
    }
  },
  Ages: { lookup: () => ({ AgeType: "AGE_ANTIQUITY" }) }
};
globalThis.Constructibles = { getByComponentID: (cid) => ({ type: cid.type }) };
globalThis.Locale = { compose: (tag, ...args) => [tag, ...args].join("|") };
globalThis.Game = {
  turn: 10, age: 1,
  getHash: (s) => `#${s}`,
  AgeProgressManager: { ageCountdownStarted: false, isAgeOver: false, getMaxAgeProgressionPoints: () => 100,
    getCurrentAgeProgressionPoints: () => 10 },
  PlayerOperations: {
    sendRequest: (pid, kind, args) => {
      requests.push({ pid, kind, args });
      if (kind === "CREATE_ELEMENT" && onCreate) onCreate(args);
    }
  },
  Notifications: {
    send: (n, pid) => notifications.push({ ...n, pid, id: notifications.length }),
    getIdsForPlayer: () => notifications.filter((n) => !n.dismissed).map((n) => n.id),
    find: (id) => notifications[id],
    getSummary: (id) => notifications[id].Summary,
    dismiss: (id) => { notifications[id].dismissed = true; }
  }
};
const origError = console.error;
console.error = (m) => { logs.push(String(m)); };

const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");
const flip = await import("/cultural-diffusion/ui/cd-city-flip.js");
const { claimCountsFor } = await import("/cultural-diffusion/ui/cd-flip.js");
const { __test: passTest } = await import("/cultural-diffusion/ui/cd-pass.js");
const { normalizeState } = await import("/cultural-diffusion/ui/cd-state.js");

// Our town A, the rival's town B four tiles away (five plots), the rival's capital far off, a minor's town nearby.
const A = { x: 10, y: 10 };
const B = { x: 14, y: 10 };
const B_PLOTS = [B, { x: 15, y: 10 }, { x: 13, y: 10 }, { x: 14, y: 11 }, { x: 14, y: 9 }];
// Our land around B: six countryside tiles within three of its center that aren't B's, so we already hold 6 of
// (6 + B's 4 rural) = 60% of its countryside, the land gate's bar. The field has eaten the land first; the center
// comes last.
const A_LAND = GameplayMap.getPlotIndicesInRadius(B.x, B.y, 3).map(dec)
  .filter((p) => !B_PLOTS.some((q) => q.x === p.x && q.y === p.y) && !(p.x === A.x && p.y === A.y)).slice(0, 6);
const ageCfg = () => ({ ...CONFIG, minimumOwner: 300 });

function world() {
  players.clear(); cities.clear(); owners.clear();
  requests.length = 0; notifications.length = 0; grievances.length = 0; logs.length = 0; war.clear();
  savedState = null; multiplayer = false; onCreate = null;
  delete globalThis.__towerPartisans;
  Game.turn++; // each test is its own turn, as far as the notices go
  makePlayer(ME); makePlayer(RIVAL); makePlayer(MINOR, { major: false });
  makeCity(1, ME, A, [A, ...A_LAND]);
  makeCity(2, RIVAL, B, B_PLOTS);
  makeCity(3, RIVAL, { x: 60, y: 60 }, [{ x: 60, y: 60 }], { isCapital: true });
  makeCity(4, MINOR, { x: 10, y: 14 }, [{ x: 10, y: 14 }]);
  Object.assign(CONFIG, { cityFlips: true, cityFlipCapitals: false, cityFlipEliminates: false, cityFlipHoldPasses: 3,
    cityFlipGrievances: 30, cityFlipWaitMs: 250, cityFlipNoticeDelayMs: 5, flipCooldownTurns: 15, captureTransfer: true });
  flip.__test.reset();
}

/** Our culture has clearly won B: its center and four of its five plots. */
function wonField() {
  const f = {};
  f[tk(B.x, B.y)] = { [ME]: 2000, [RIVAL]: 500 };
  for (const p of B_PLOTS.slice(1, 4)) f[tk(p.x, p.y)] = { [ME]: 800, [RIVAL]: 100 };
  f[tk(14, 9)] = { [RIVAL]: 900 };
  f[tk(10, 14)] = { [ME]: 5000, [MINOR]: 10 };
  return f;
}
const region = () => new Set(GameplayMap.getPlotIndicesInRadius(A.x, A.y, 8).map(dec).map((p) => tk(p.x, p.y)));
const freshState = () => normalizeState({});
const step = (state, field = wonField()) => flip.cityFlipStep({ state, next: field, region: region(), ageCfg: ageCfg(), deadOwners: [] });

test("pass step: warns on the first pass, counts down on the next, picks the settlement on the third", () => {
  world();
  const state = freshState();
  let out = step(state);
  assert.deepEqual(state.cityHold[tk(B.x, B.y)], { by: ME, owner: RIVAL, n: 1 });
  assert.equal(out.launch.length, 0);
  assert.equal(notifications.length, 1, "one warning");
  assert.equal(notifications[0].Type, "#NOTIFICATION_CD_CITY_FLIP_WARN");
  assert.match(notifications[0].Summary, /LOC_CD_CITY_FLIP_WARNING\|CITY_2\|CIV_0/);
  out = step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)].n, 2);
  assert.equal(notifications.length, 2, "the second pass counts down");
  assert.match(notifications[1].Summary, /LOC_CD_CITY_FLIP_COUNTDOWN_LAST\|CITY_2\|CIV_0/, "one pass left: next turn");
  out = step(state);
  assert.equal(notifications.length, 2, "the pass that flips sends no countdown; the joined notice follows it");
  assert.equal(out.launch.length, 1);
  assert.equal(out.launch[0].key, tk(B.x, B.y));
  assert.equal(out.launch[0].leader, ME);
  assert.ok(!state.cityHold[tk(10, 14)], "the minor's town is never tracked");
});

test("pass step: a lost pass resets the count", () => {
  world();
  const state = freshState();
  step(state); step(state);
  const lost = wonField();
  lost[tk(B.x, B.y)] = { [ME]: 1000, [RIVAL]: 500 }; // exactly twice: not clear
  step(state, lost);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined);
});

test("pass step: the plot share must reach 60%", () => {
  world();
  const state = freshState();
  const f = wonField();
  f[tk(15, 10)] = { [RIVAL]: 900 }; // now the center and two of five plots: 3/5 = 60%, still enough
  step(state, f);
  assert.equal(state.cityHold[tk(B.x, B.y)].n, 1);
  f[tk(13, 10)] = { [RIVAL]: 900 }; // 2/5
  step(state, f);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined);
});

test("pass step: the countryside must already be 60% the leader's; the land goes first, the center last", () => {
  world();
  // Three of our six tiles around B back to unowned: 3 of (3 + 4) = 43%, under the bar.
  for (const p of A_LAND.slice(0, 3)) owners.delete(tk(p.x, p.y));
  const state = freshState();
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined, "the culture has won the center and the plots, but not the land");
  assert.equal(notifications.length, 0, "and nobody is warned");
  // B's own rural tiles going to us is what moves the share: two of them ours makes 5 of (5 + 2) = 71%.
  for (const p of B_PLOTS.slice(1, 3)) owners.set(tk(p.x, p.y), ME);
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)].n, 1, "the countryside has gone, the hold starts");
  // The bar is a knob: at 0 the field alone decides, as in 1.6.
  world();
  for (const p of A_LAND) owners.delete(tk(p.x, p.y));
  CONFIG.cityFlipLandShare = 0;
  const s2 = freshState();
  step(s2);
  assert.equal(s2.cityHold[tk(B.x, B.y)].n, 1);
  CONFIG.cityFlipLandShare = 0.6;
});

test("pass step: a longer hold counts down turn by turn", () => {
  world();
  CONFIG.cityFlipHoldPasses = 5;
  const state = freshState();
  for (let i = 0; i < 4; i++) step(state);
  assert.equal(notifications.length, 4);
  assert.match(notifications[1].Summary, /LOC_CD_CITY_FLIP_COUNTDOWN\|CITY_2\|CIV_0\|3$/, "3 turns left after pass 2");
  assert.match(notifications[2].Summary, /LOC_CD_CITY_FLIP_COUNTDOWN\|CITY_2\|CIV_0\|2$/);
  assert.match(notifications[3].Summary, /LOC_CD_CITY_FLIP_COUNTDOWN_LAST\|CITY_2\|CIV_0$/);
  const out = step(state);
  assert.equal(out.launch.length, 1, "the fifth pass flips");
  CONFIG.cityFlipHoldPasses = 3;
});

test("pass step: war, a capital, a last settlement, an age change and multiplayer hold it", () => {
  world();
  war.add(`${ME},${RIVAL}`);
  let state = freshState();
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined, "at war");

  world();
  cities.get(2).isCapital = true;
  state = freshState();
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined, "capital, setting off");
  CONFIG.cityFlipCapitals = true;
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)].n, 1, "capital, setting on");

  world();
  cities.delete(3); // B is now the rival's only settlement
  state = freshState();
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined, "last settlement, setting off");

  world();
  state = freshState();
  step(state);
  Game.AgeProgressManager.ageCountdownStarted = true;
  const out = step(state); step(state);
  Game.AgeProgressManager.ageCountdownStarted = false;
  assert.equal(state.cityHold[tk(B.x, B.y)].n, 1, "the count waits through the age change");
  assert.equal(out.launch.length, 0);

  world();
  multiplayer = true;
  state = freshState();
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined, "network game");
});

test("pass step: the same team never flips; the feature off clears every count", () => {
  world();
  players.get(RIVAL).team = 0;
  let state = freshState();
  step(state);
  assert.equal(state.cityHold[tk(B.x, B.y)], undefined);

  world();
  state = freshState();
  step(state);
  CONFIG.cityFlips = false;
  step(state);
  assert.deepEqual(state.cityHold, {});
});

test("busy plots: a settlement one pass from the bar keeps the tile path off all its plots", () => {
  world();
  const state = freshState();
  step(state);
  assert.equal(flip.settlementBusyKeys(state).size, 0, "pass 1 of 3: not yet");
  step(state);
  const busy = flip.settlementBusyKeys(state);
  for (const p of B_PLOTS) assert.ok(busy.has(tk(p.x, p.y)), `plot ${tk(p.x, p.y)} held for the flip`);
  assert.equal(busy.size, B_PLOTS.length);
});

test("pass step: a tile change still landing on one of its plots makes the flip wait a pass", () => {
  world();
  const state = freshState();
  step(state); step(state);
  state.pending[tk(15, 10)] = { kind: "claim", by: 5, city: 9, turn: 1, was: RIVAL, hold: 0 };
  const out = step(state);
  assert.equal(out.launch.length, 0);
  assert.equal(state.cityHold[tk(B.x, B.y)].n, 3, "the count holds");
});

/** The engine's transfer: the city, its plots and its buildings go to the marker's leader in one step. */
function engineTransfers({ skip = [] } = {}) {
  onCreate = (args) => {
    setTimeout(() => {
      const old = cities.get(2);
      cities.delete(2);
      const moved = makeCity(5, ME, old.location, B_PLOTS.filter((p) => !skip.includes(tk(p.x, p.y))));
      for (const s of skip) owners.set(s, RIVAL);
      moved.markers.push({ cid: { owner: ME, id: 77, type: MARKER_INDEX } });
      assert.equal(args.Type, "BUILDING_CD_FLIP_LEADER_P0");
      flip.onSettlementTransfer({ fromPlayer: RIVAL, transferType: "BY_CULTURAL_IDENTITY", cityID: moved.id });
    }, 20);
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("flip: marker, transfer, marker out, plots booked together, grievances, one notice with Partisans' line", async () => {
  world();
  engineTransfers();
  globalThis.__towerPartisans = { flipOutlook: (k) => (k === tk(B.x, B.y) ? { turns: 3, line: "PARTISANS_LINE" } : null) };
  const state = freshState();
  step(state); step(state);
  const out = step(state);
  // Left from earlier tile work on two of its plots: a tile claim and a tile verb still on the books.
  state.claims[tk(15, 10)] = { by: RIVAL, city: 2, turn: 1 };
  state.pending[tk(13, 10)] = { kind: "claim", by: RIVAL, city: 2, turn: 1, was: -1, hold: 0 };
  savedState = state;
  const res = await flip.launchCityFlips(out.launch)[0];
  assert.equal(res.ok, true);
  assert.equal(res.booked, 5);

  const create = requests.find((r) => r.kind === "CREATE_ELEMENT");
  assert.deepEqual(create.args, { Kind: "CONSTRUCTIBLE", Type: "BUILDING_CD_FLIP_LEADER_P0", Location: B, Owner: RIVAL });
  assert.equal(create.pid, ME, "sent as the local player");
  const destroy = requests.find((r) => r.kind === "DESTROY_ELEMENT");
  assert.deepEqual(destroy.args, { Kind: "CONSTRUCTIBLE", Owner: ME, LocalID: 77 }, "the marker comes out");
  assert.ok(!requests.some((r) => r.kind !== "CREATE_ELEMENT" && r.kind !== "DESTROY_ELEMENT"), "no purchasePlot, no other verb");

  for (const p of B_PLOTS) {
    const c = savedState.claims[tk(p.x, p.y)];
    assert.deepEqual({ by: c.by, city: c.city, settlement: c.settlement }, { by: ME, city: 5, settlement: true }, tk(p.x, p.y));
    assert.equal(savedState.locked[tk(p.x, p.y)], 15);
    assert.ok(!savedState.pending[tk(p.x, p.y)]);
  }
  assert.equal(savedState.cityHold[tk(B.x, B.y)], undefined, "the count is done");
  assert.deepEqual(grievances, [{ on: ME, target: RIVAL, n: 30000 }], "booked on the receiver, aimed at the loser");

  await sleep(40);
  const joined = notifications.filter((n) => n.Type === "#NOTIFICATION_CD_CITY_FLIP");
  assert.equal(joined.length, 1);
  const lines = joined[0].Summary.split("[N]");
  assert.equal(lines[0], "LOC_CD_CITY_FLIP_JOINED|CITY_2|CIV_0");
  assert.equal(lines[1], "LOC_CD_CITY_FLIP_GRIEVANCES|CIV_3|CIV_0|30");
  assert.equal(lines[2], "PARTISANS_LINE", "Partisans' line closes the notice");
  delete globalThis.__towerPartisans;
});

test("flip: a plot that doesn't show the new owner is logged and left alone, never patched", async () => {
  world();
  engineTransfers({ skip: [tk(14, 9)] });
  CONFIG.cityFlipGrievances = 0;
  const state = freshState();
  step(state); step(state);
  const out = step(state);
  savedState = state;
  const res = await flip.launchCityFlips(out.launch)[0];
  assert.equal(res.ok, true);
  assert.deepEqual(res.wrong, []); // the city's own list no longer holds the plot
  assert.equal(savedState.claims[tk(14, 9)], undefined);
  assert.deepEqual(grievances, [], "no grievances at 0");
  await sleep(30);
  const joined = notifications.find((n) => n.Type === "#NOTIFICATION_CD_CITY_FLIP");
  assert.equal(joined.Summary.split("[N]").length, 1, "no grievance line, no Partisans line");
});

test("flip: no transfer within the wait: marker out, plots untouched, count reset, refusal logged", async () => {
  world();
  onCreate = (args) => {
    // The marker lands but nothing transfers.
    cities.get(2).markers.push({ cid: { owner: RIVAL, id: 88, type: MARKER_INDEX } });
    assert.ok(args);
  };
  const state = freshState();
  step(state); step(state);
  const out = step(state);
  savedState = state;
  const res = await flip.launchCityFlips(out.launch)[0];
  assert.equal(res.ok, false);
  assert.equal(res.reason, "no-transfer");
  assert.ok(requests.some((r) => r.kind === "DESTROY_ELEMENT" && r.args.LocalID === 88), "marker removed");
  assert.equal(savedState.cityHold[tk(B.x, B.y)], undefined, "count reset");
  for (const p of B_PLOTS) assert.equal(owners.get(tk(p.x, p.y)), RIVAL);
  assert.deepEqual(Object.keys(savedState.claims), []);
  assert.ok(logs.some((l) => l.includes("city flip refused")));
  assert.deepEqual(grievances, []);
});

test("flip: a transfer that lands after the wait is still cleaned up and booked", () => {
  world();
  const state = freshState();
  savedState = state;
  // A marker request queued earlier lands now: B is ours, the marker inside it, and no flip is waiting.
  const old = cities.get(2);
  cities.delete(2);
  const moved = makeCity(6, ME, old.location, B_PLOTS);
  moved.markers.push({ cid: { owner: ME, id: 55, type: MARKER_INDEX } });
  flip.onSettlementTransfer({ fromPlayer: RIVAL, transferType: "BY_CULTURAL_IDENTITY", cityID: moved.id });
  assert.ok(requests.some((r) => r.kind === "DESTROY_ELEMENT" && r.args.LocalID === 55), "marker removed");
  assert.equal(savedState.claims[tk(B.x, B.y)].settlement, true, "booked");
  assert.deepEqual(grievances, [{ on: ME, target: RIVAL, n: 30000 }]);
  assert.ok(logs.some((l) => l.includes("landed after its wait")));
});

test("flip: an ordinary capture with no marker is left to the capture rule", () => {
  world();
  savedState = freshState();
  const old = cities.get(2);
  cities.delete(2);
  const moved = makeCity(7, ME, old.location, B_PLOTS);
  flip.onSettlementTransfer({ fromPlayer: RIVAL, transferType: "BY_COMBAT", cityID: moved.id });
  assert.equal(requests.length, 0);
  assert.deepEqual(savedState.claims, {});
  assert.deepEqual(grievances, []);
});

test("flip: one at a time, and the sweep leaves a waiting flip's marker alone", async () => {
  world();
  engineTransfers();
  const state = freshState();
  step(state); step(state);
  const out = step(state);
  savedState = state;
  const pending = flip.launchCityFlips([...out.launch, ...out.launch]);
  assert.equal(pending.length, 1, "a second flip waits for the first");
  assert.equal(flip.sweepFlipMarkers(), 0, "no sweep mid-flip");
  await pending[0];
});

test("notices: a second settlement of a kind joins the live notice instead of being dropped", async () => {
  world();
  const { notifySettlement } = await import("/cultural-diffusion/ui/cd-notifications.js");
  notifySettlement("joined", "A has joined X.", "T");
  notifySettlement("joined", "B has joined Y.", "T");
  const live = notifications.filter((n) => !n.dismissed);
  assert.equal(live.length, 1, "one live notice");
  assert.equal(live[0].Summary, "A has joined X.[N][N]B has joined Y.");
  notifySettlement("warn", "D looks to W.", "T");
  assert.equal(notifications.at(-1).Summary, "D looks to W.", "another kind stands on its own");
});

test("sweep: every stray marker in every major's settlement goes", () => {
  world();
  cities.get(2).markers.push({ cid: { owner: RIVAL, id: 91, type: MARKER_INDEX } });
  cities.get(1).markers.push({ cid: { owner: ME, id: 92, type: MARKER_INDEX } });
  assert.equal(flip.sweepFlipMarkers(), 2);
  assert.deepEqual(requests.filter((r) => r.kind === "DESTROY_ELEMENT").map((r) => r.args.LocalID).sort(), [91, 92]);
});

test("sweep: waits for the game to start, then retries until the markers are gone", async () => {
  world();
  const city = cities.get(2);
  city.markers.push({ cid: { owner: RIVAL, id: 93, type: MARKER_INDEX } });
  let state = 6;
  let dropFirst = true; // the first removal after the start is lost, as watched at a new age's start
  onCreate = null;
  const orig = Game.PlayerOperations.sendRequest;
  Game.PlayerOperations.sendRequest = (pid, kind, args) => {
    requests.push({ pid, kind, args });
    if (kind === "DESTROY_ELEMENT" && !dropFirst) city.markers = city.markers.filter((m) => m.cid.id !== args.LocalID);
    dropFirst = false;
  };
  globalThis.UI = { getGameLoadingState: () => state };
  globalThis.UIGameLoadingState = { GameStarted: 8 };
  const done = flip.sweepWhenStarted({ pollMs: 10, settleMs: 10, tries: 5, maxMs: 2000 });
  await sleep(40);
  assert.equal(requests.filter((r) => r.kind === "DESTROY_ELEMENT").length, 0, "nothing sent behind the load screen");
  state = 8;
  const res = await done;
  assert.deepEqual(res, { sent: 2, left: 0 }, "sent twice, gone after the second");
  assert.ok(logs.some((l) => l.includes("0 stray marker(s) left")));
  Game.PlayerOperations.sendRequest = orig;
  delete globalThis.UI;
  delete globalThis.UIGameLoadingState;
});

test("claims: a joined settlement's plots never count toward a cap and keep their claim records", () => {
  world();
  const state = freshState();
  state.claims[tk(11, 10)] = { by: ME, city: 1, turn: 1, settlement: true };
  state.claims[tk(12, 10)] = { by: ME, city: 1, turn: 1 };
  assert.equal(claimCountsFor(state, ME).get(1), 1, "only the tile claim counts");
  owners.set(tk(11, 10), ME); owners.set(tk(12, 10), ME);
  let unclaimed = 0;
  globalThis.WorldBuilder = { MapPlots: { setOwnership: () => { unclaimed++; } } };
  const released = passTest.releaseInnerClaims(state, [{ loc: A }], ME);
  assert.equal(released, 1, "the tile claim inside our ring loses its record");
  assert.equal(unclaimed, 0, "...without a release call, which the engine ignores on a city-attached tile");
  assert.ok(state.claims[tk(11, 10)], "the settlement's plot stays");
  assert.equal(normalizeState({ claims: state.claims }).claims[tk(11, 10)].settlement, true, "the mark survives a save");
});

// ── The settlement path never goes through a tile gate ───────────────────────────────────────────────────────────
const TILE_GATES = ["rivalClaimAllowed", "isCoreProtected", "protectRadiusFor", "flipRefusedFor", "plotInventory",
  "claimGateBlocked", "claimInScope", "flipEligible", "commitFlip", "claimCountsFor", "performFlip", "purchasePlot",
  "markPending", "withinOwnNaturalRing", "adjacentToMe", "wouldStrandForeignUnit", "districtTransferPaused",
  "distantLandsGated", "conquerable"];
const TILE_MODULES = ["cd-eligibility.js", "cd-flip.js", "cd-ownership.js", "cd-teardown.js", "cd-ai-flips.js",
  "cd-recede.js", "cd-conquest.js", "cd-pending.js", "cd-units.js", "cd-pass.js"];
const SETTLEMENT_PATH = ["ui/cd-city-flip.js", "ui/cd-city-flip-rule.js"];

/** Every module a file reaches through its imports, by file name. */
function importClosure(file, seen = new Set()) {
  const name = path.basename(file);
  if (seen.has(name)) return seen;
  seen.add(name);
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/from\s+"\/cultural-diffusion\/(ui\/[\w-]+\.js)"/g)) importClosure(m[1], seen);
  return seen;
}

test("isolation: the settlement path names no tile gate", () => {
  for (const f of SETTLEMENT_PATH) {
    const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const g of TILE_GATES) assert.ok(!new RegExp(`\\b${g}\\b`).test(code), `${f} uses ${g}`);
  }
});

test("isolation: the settlement path can't reach a tile-flip module through its imports", () => {
  for (const f of SETTLEMENT_PATH) {
    const reach = importClosure(f);
    for (const m of TILE_MODULES) assert.ok(!reach.has(m), `${f} reaches ${m}`);
  }
});

test("isolation: the check bites", () => {
  assert.ok(importClosure("ui/cd-pass.js").has("cd-eligibility.js"), "the pass does reach the tile gates");
});

test.after(() => { console.error = origError; });
