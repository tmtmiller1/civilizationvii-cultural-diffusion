// tests/city-flip-rule.mjs: the whole-settlement flip rule (ui/cd-city-flip-rule.js), pure. Who leads a center,
// when the center and the plots count as won, every gate and its order, the hold counter, and the per-pass pick.
import test from "node:test";
import assert from "node:assert/strict";
import {
  markerFor, isFlipMarker, strongestOn, centreWon, plotShareLed, cityFlipRefusal, nextHold, flipDue, pickFlips
} from "/cultural-diffusion/ui/cd-city-flip-rule.js";

const CFG = {
  cityFlips: true, cityFlipCapitals: false, cityFlipEliminates: false, cityFlipRatio: 0.5, cityFlipBar: 2,
  minimumOwner: 300, cityFlipHoldPasses: 3, maxCityFlipsPerPass: 1
};

test("rule: markers are named after the leader and recognised by prefix", () => {
  assert.equal(markerFor("LEADER_PERICLES"), "BUILDING_CD_FLIP_LEADER_PERICLES");
  assert.ok(isFlipMarker("BUILDING_CD_FLIP_LEADER_PERICLES"));
  assert.ok(!isFlipMarker("BUILDING_PALACE"));
  assert.ok(!isFlipMarker(undefined));
});

test("rule: the strongest living culture leads; dead civs are ignored", () => {
  assert.deepEqual(strongestOn({ 0: 100, 3: 900, 5: 400 }, []), { leader: 3, value: 900 });
  assert.deepEqual(strongestOn({ 0: 100, 3: 900, 5: 400 }, [3]), { leader: 5, value: 400 });
  assert.deepEqual(strongestOn(undefined, []), { leader: -1, value: 0 });
  assert.deepEqual(strongestOn({}, []), { leader: -1, value: 0 });
});

test("rule: the center is won at more than twice the owner and past twice the age's bar", () => {
  // bar = 300 x 2 = 600; ratio 0.5 = the leader needs more than twice the owner.
  assert.ok(centreWon({ 3: 1300, 0: 600 }, 3, 0, CFG), "1300 x 0.5 = 650 > 600, and 1300 > 600");
  assert.ok(!centreWon({ 3: 1200, 0: 600 }, 3, 0, CFG), "exactly twice the owner isn't clear");
  assert.ok(!centreWon({ 3: 590, 0: 0 }, 3, 0, CFG), "under the bar, even with no owner culture");
  assert.ok(centreWon({ 3: 601 }, 3, 0, CFG), "just past the bar with the owner absent");
  assert.ok(!centreWon({ 3: 5000, 0: 10 }, 0, 0, CFG), "the owner leading its own center never counts");
  assert.ok(!centreWon(undefined, 3, 0, CFG), "a center the field never reached");
  // The age bar comes in through minimumOwner (the pass passes the age-adjusted config).
  assert.ok(!centreWon({ 3: 700 }, 3, 0, { ...CFG, minimumOwner: 375 }), "Exploration: 750 needed");
});

test("rule: the plot share counts plots the leader leads, unreached plots as not led", () => {
  const rows = [{ 3: 500, 0: 100 }, { 3: 100, 0: 500 }, undefined, { 3: 50 }, { 0: 1, 3: 2 }];
  assert.equal(plotShareLed(rows, 3, []), 3 / 5);
  assert.equal(plotShareLed(rows, 0, []), 1 / 5);
  assert.equal(plotShareLed([], 3, []), 0);
  assert.equal(plotShareLed([{ 3: 500, 5: 900 }], 3, [5]), 1, "a dead civ's stock never leads");
});

/** Facts for a settlement that may flip, overridden per test. */
const facts = (over = {}) => ({
  owner: 0, leader: 3, ownerMajor: true, leaderMajor: true, sameTeam: false, atWar: false, isCapital: false,
  ownerSettlements: 4, distantLands: false, paused: false, multiplayer: false, ...over
});

test("rule: a settlement with no gate holding it is free to flip", () => {
  assert.equal(cityFlipRefusal(facts(), CFG), null);
});

test("rule: every gate holds the settlement, and names itself", () => {
  const cases = [
    [{}, { cityFlips: false }, "off"],
    [{ multiplayer: true }, {}, "multiplayer"],
    [{ paused: true }, {}, "age-transition"],
    [{ ownerMajor: false }, {}, "not-major"],
    [{ leader: -1 }, {}, "no-leader"],
    [{ leader: 0 }, {}, "owner-leads"],
    [{ leaderMajor: false }, {}, "not-major"],
    [{ sameTeam: true }, {}, "same-team"],
    [{ atWar: true }, {}, "at-war"],
    [{ isCapital: true }, {}, "capital"],
    [{ ownerSettlements: 1 }, {}, "last-settlement"],
    [{ distantLands: true }, {}, "distant-lands"]
  ];
  for (const [f, c, want] of cases) assert.equal(cityFlipRefusal(facts(f), { ...CFG, ...c }), want, want);
});

test("rule: capitals and last settlements flip only with their settings on", () => {
  assert.equal(cityFlipRefusal(facts({ isCapital: true }), { ...CFG, cityFlipCapitals: true }), null);
  assert.equal(cityFlipRefusal(facts({ ownerSettlements: 1 }), { ...CFG, cityFlipEliminates: true }), null);
  // A capital that's also the last settlement needs both.
  const both = facts({ isCapital: true, ownerSettlements: 1 });
  assert.equal(cityFlipRefusal(both, { ...CFG, cityFlipCapitals: true }), "last-settlement");
  assert.equal(cityFlipRefusal(both, { ...CFG, cityFlipCapitals: true, cityFlipEliminates: true }), null);
});

test("rule: a city-state or independent owner never flips, whatever else holds", () => {
  assert.equal(cityFlipRefusal(facts({ ownerMajor: false, atWar: false, isCapital: false }), CFG), "not-major");
  assert.equal(cityFlipRefusal(facts({ ownerMajor: false }), { ...CFG, cityFlipCapitals: true, cityFlipEliminates: true }),
    "not-major");
});

test("rule: the hold counts up while won, and restarts on a lost pass or a new leader or owner", () => {
  let h = nextHold(null, 3, 0, true);
  assert.deepEqual(h, { by: 3, owner: 0, n: 1 });
  h = nextHold(h, 3, 0, true);
  assert.deepEqual(h, { by: 3, owner: 0, n: 2 });
  assert.equal(nextHold(h, 3, 0, false), null, "a pass not won resets");
  assert.deepEqual(nextHold(h, 5, 0, true), { by: 5, owner: 0, n: 1 }, "a new leader starts over");
  assert.deepEqual(nextHold(h, 3, 7, true), { by: 3, owner: 7, n: 1 }, "a new owner starts over");
});

test("rule: due at cityFlipHoldPasses", () => {
  assert.ok(!flipDue({ n: 2 }, CFG));
  assert.ok(flipDue({ n: 3 }, CFG));
  assert.ok(flipDue({ n: 4 }, CFG));
  assert.ok(!flipDue(null, CFG));
  assert.ok(flipDue({ n: 1 }, { cityFlipHoldPasses: 0 }), "a bar under 1 still needs one pass");
});

test("rule: one flip per pass by default, longest held first, then the strongest lead", () => {
  const a = { key: "a", hold: { n: 3 }, lead: 900 };
  const b = { key: "b", hold: { n: 5 }, lead: 100 };
  const c = { key: "c", hold: { n: 5 }, lead: 800 };
  assert.deepEqual(pickFlips([a, b, c], CFG).map((d) => d.key), ["c"]);
  assert.deepEqual(pickFlips([a, b, c], { maxCityFlipsPerPass: 2 }).map((d) => d.key), ["c", "b"]);
  assert.deepEqual(pickFlips([a, b, c], { maxCityFlipsPerPass: 0 }), []);
});
