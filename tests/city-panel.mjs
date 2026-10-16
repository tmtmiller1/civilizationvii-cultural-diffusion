// tests/city-panel.mjs: the Cultural Diffusion section of the City Details panel (ui/cd-city-panel.js), its lines
// pure given the readout's answer. The section and the hover readout share the hold wording, so what one says the
// other says.
import test from "node:test";
import assert from "node:assert/strict";

// The engine surface the tooltip module touches when it loads (same shape as tests/lens-parity.mjs, minimal).
globalThis.PlayerIds = { NO_PLAYER: -1 };
globalThis.GameContext = { localPlayerID: 0 };
globalThis.Configuration = { getGame: () => ({ isAnyMultiplayer: false, getValue: () => null }), editGame: () => ({ setValue: () => {} }) };
globalThis.GameplayMap = { getOwner: () => -1, getOwningCityFromXY: () => ({ id: -1 }), getPlotIndicesInRadius: () => [], getLocationFromIndex: () => ({ x: 0, y: 0 }) };
globalThis.Cities = { getAtLocation: () => null, get: () => null };
globalThis.Players = { getAlive: () => [], get: () => null };
globalThis.Game = { age: "AGE_ANTIQUITY", turn: 10 };
globalThis.WorldUI = { createOverlayGroup: () => ({ clearAll: () => {}, addPlotOverlay: () => ({ addPlots: () => {}, clear: () => {} }) }) };
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { activeElement: null };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
// A translation that shows its key and arguments, the way the other suites do.
globalThis.Locale = { compose: (tag, ...args) => [tag, ...args].join("|") };

const { panelLines } = await import("/cultural-diffusion/ui/cd-city-panel.js");

const civ = (pid) => `CIV_${pid}`;
const outlook = (over = {}) => ({
  leader: 3, owner: 0, n: 0, need: 5, won: false, refusal: null, landShort: false, lead: 1840.4, ownerStock: 620.2,
  land: { leaderOwned: 7, ownerRural: 4, share: 7 / 11 }, ...over
});

test("panel: the feature off says so, and nothing is said where no major's settlement stands", () => {
  assert.deepEqual(panelLines(null, civ, false), [{ key: "LOC_CD_PANEL_OFF", args: [] }]);
  assert.deepEqual(panelLines(null, civ, true), []);
});

test("panel: the owner's own culture leading reads as calm", () => {
  assert.deepEqual(panelLines(outlook({ leader: 0 }), civ, true), [{ key: "LOC_CD_PANEL_CALM", args: ["CIV_0"] }]);
  assert.deepEqual(panelLines(outlook({ leader: -1 }), civ, true), [{ key: "LOC_CD_PANEL_CALM", args: ["CIV_0"] }]);
});

test("panel: a leaning settlement shows who it leans to, the hold, the center split and the countryside", () => {
  const lines = panelLines(outlook({ n: 2 }), civ, true);
  assert.deepEqual(lines[0], { key: "LOC_CD_CITY_FLIP_ROW", args: ["CIV_3"] });
  assert.equal(lines[1].text, "2 / 5", "the readout's own hold wording");
  assert.deepEqual(lines[2], { key: "LOC_CD_PANEL_CENTRE", args: ["CIV_3", 1840, "CIV_0", 620] });
  assert.deepEqual(lines[3], { key: "LOC_CD_PANEL_LAND", args: ["CIV_3", 7, "CIV_0", 4] });
});

test("panel: what holds it is said in the readout's words", () => {
  assert.equal(panelLines(outlook({ refusal: "at-war" }), civ, true)[1].text, "at-war");
  assert.equal(panelLines(outlook({ landShort: true }), civ, true)[1].text, "held: the countryside is still theirs");
  assert.equal(panelLines(outlook(), civ, true)[1].text, "culture not yet clear");
});

test("panel: a city-state's or independent's lead can't take the settlement, so it reads as calm", () => {
  assert.deepEqual(panelLines(outlook({ leader: 20, refusal: "not-major" }), civ, true),
    [{ key: "LOC_CD_PANEL_CALM", args: ["CIV_0"] }]);
});
