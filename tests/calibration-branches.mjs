// tests/calibration-branches.mjs - branch/edge hardening for game-settings calibration.
// Exercises the readMaxTurns guards, the safe() catch, the paceReferenceTurns/paceBounds
// fallbacks, and the Configuration->GameInfo map-size fallthrough (so the GameInfo branch and
// the Configuration optional-chaining actually run).
import assert from "node:assert/strict";

// Reassignable engine stubs.
let maxTurnsValue = 90;
let maxTurnsThrows = false;
globalThis.Game = { get maxTurns() { if (maxTurnsThrows) throw new Error("boom"); return maxTurnsValue; } };

// Configuration + GameInfo/GameplayMap are swapped per-scenario below.
let configImpl = { getMap: () => ({ mapSizeTypeName: "MAPSIZE_STANDARD" }) };
globalThis.Configuration = new Proxy({}, { get: (_t, k) => configImpl[k] });
let gameInfoImpl = null;
globalThis.GameInfo = new Proxy({}, { get: (_t, k) => (gameInfoImpl ? gameInfoImpl[k] : undefined) });
globalThis.GameplayMap = { getMapSize: () => 7 };

const { agePace, mapSizeScale, ageProgress } = await import("/cultural-diffusion/ui/cd-calibration.js");
const { CONFIG } = await import("/cultural-diffusion/ui/cd-config.js");

// --- safe() catch returns the fallback when the engine read throws ---
maxTurnsThrows = true;
assert.equal(agePace(), 1, "a throwing Game.maxTurns is caught -> neutral pace (catch returns fallback 1)");
maxTurnsThrows = false;

// --- readMaxTurns(): a non-positive turn budget is treated as unreadable (0 -> neutral) ---
maxTurnsValue = -5;
assert.equal(agePace(), 1, "negative maxTurns -> neutral (the '&&' guard, not '||'; returns 0 not -5)");
maxTurnsValue = 0;
assert.equal(agePace(), 1, "zero maxTurns -> neutral");
// A numeric-STRING budget passes '> 0' but must be rejected by the typeof half of the guard
// (kills the 'typeof maxTurns === number -> true' left-operand mutant that would read "45").
maxTurnsValue = "45";
assert.equal(agePace(), 1, "a numeric-string maxTurns is rejected by the typeof guard -> neutral");
maxTurnsValue = 90;

// --- paceReferenceTurns is the numerator (|| 90 fallback, not &&) ---
CONFIG.paceReferenceTurns = 120;
maxTurnsValue = 120;
assert.ok(Math.abs(agePace() - 1) < 1e-9, "reference 120 with a 120-turn age paces at exactly 1 (ref is used verbatim)");
maxTurnsValue = 240;
assert.ok(Math.abs(agePace() - 0.5) < 1e-9, "ref 120 / 240-turn age -> 0.5");
CONFIG.paceReferenceTurns = 90;
maxTurnsValue = 90;

// --- paceBounds fallback is [0.25,3], not [] ---
const savedBounds = CONFIG.paceBounds;
CONFIG.paceBounds = null; // force the fallback literal
maxTurnsValue = 100000;    // k -> ~0, must clamp to the floor 0.25
assert.ok(Math.abs(agePace() - 0.25) < 1e-9, "invalid paceBounds -> [0.25,3] fallback floors at 0.25 (not NaN from [])");
maxTurnsValue = 1;         // k huge, clamp to ceil 3
assert.ok(Math.abs(agePace() - 3) < 1e-9, "fallback ceils at 3");
CONFIG.paceBounds = savedBounds;
maxTurnsValue = 90;

// --- map size: Configuration path returns the value directly ---
configImpl = { getMap: () => ({ mapSizeTypeName: "MAPSIZE_HUGE" }) };
gameInfoImpl = null;
assert.ok(Math.abs(mapSizeScale() - 1.1) < 1e-9, "HUGE via Configuration -> 1.1 (config path returns its value)");
configImpl = { getMap: () => ({ mapSizeTypeName: "MAPSIZE_STANDARD" }) };
assert.equal(mapSizeScale(), 1, "STANDARD -> neutral 1");

// --- fallthrough: Configuration yields nothing, GameInfo.Maps provides the size ---
// This makes the GameInfo branch (mapSizeTypeFromGameInfo) the deciding read, and proves the
// Configuration optional-chaining is real: when Configuration is broken the code must fall
// through gracefully to GameInfo rather than throw.
gameInfoImpl = { Maps: { lookup: () => ({ MapSizeType: "MAPSIZE_HUGE" }) } };

configImpl = { getMap: () => ({ mapSizeTypeName: "" }) };           // config present, empty name
assert.ok(Math.abs(mapSizeScale() - 1.1) < 1e-9, "empty config name -> falls through to GameInfo HUGE (1.1)");

globalThis.Configuration = undefined;                              // Configuration entirely absent
assert.ok(Math.abs(mapSizeScale() - 1.1) < 1e-9, "absent Configuration -> optional-chaining falls through to GameInfo");
globalThis.Configuration = new Proxy({}, { get: (_t, k) => configImpl[k] });

configImpl = {};                                                   // Configuration present, no getMap
assert.ok(Math.abs(mapSizeScale() - 1.1) < 1e-9, "missing getMap -> ?.() falls through to GameInfo");

configImpl = { getMap: () => undefined };                         // getMap() returns nothing
assert.ok(Math.abs(mapSizeScale() - 1.1) < 1e-9, "getMap() undefined -> ?. falls through to GameInfo");

configImpl = { getMap: () => ({ mapSizeTypeName: 123 }) };        // non-string name is rejected
assert.ok(Math.abs(mapSizeScale() - 1.1) < 1e-9, "non-string config name rejected -> GameInfo HUGE (typeof===string guard)");

// GameInfo returns a non-string type -> rejected -> neutral (config also empty here).
configImpl = { getMap: () => ({ mapSizeTypeName: "" }) };
gameInfoImpl = { Maps: { lookup: () => ({ MapSizeType: 999 }) } };
assert.equal(mapSizeScale(), 1, "non-string GameInfo MapSizeType rejected -> neutral 1");
gameInfoImpl = { Maps: { lookup: () => ({ MapSizeType: "MAPSIZE_HUGE" }) } };

// --- mapSizeScale table guard: a non-positive table value is rejected -> neutral 1 ---
const savedTable = CONFIG.mapSizeScale;
CONFIG.mapSizeScale = { MAPSIZE_HUGE: 0 };
assert.equal(mapSizeScale(), 1, "a table value of exactly 0 is rejected (v>0 guard) -> neutral 1");
CONFIG.mapSizeScale = { MAPSIZE_HUGE: -2 };
assert.equal(mapSizeScale(), 1, "a negative table value is rejected -> neutral 1");
// A numeric-STRING table value passes '> 0' but must be rejected by the typeof half of the guard.
CONFIG.mapSizeScale = { MAPSIZE_HUGE: "1.5" };
assert.equal(mapSizeScale(), 1, "a numeric-string table value is rejected by the typeof guard -> neutral 1");
CONFIG.mapSizeScale = savedTable;

// --- the `typeof Game !== "undefined"` guards: the mod must load before Game exists ---
// (UI modules are imported at load time, so an engine read can genuinely precede the Game global.)
const savedGame = globalThis.Game;
globalThis.Game = undefined;
assert.equal(agePace(), 1, "no Game global -> readMaxTurns 0 -> neutral pace (typeof guard, not a throw)");
assert.equal(ageProgress(), 0, "no Game global -> age progress 0 (start of age)");
globalThis.Game = savedGame;

// ageProgress(): a non-number Game.turn reads as turn 0, it must not poison the ratio with NaN.
maxTurnsValue = 100;
globalThis.Game = { get maxTurns() { return maxTurnsValue; }, get turn() { return "not-a-number"; } };
assert.equal(ageProgress(), 0, "a non-number Game.turn -> 0 (typeof guard), not NaN");
globalThis.Game = savedGame;
maxTurnsValue = 90;

// --- the `|| fallback` literals on the config reads ---
CONFIG.paceReferenceTurns = 0; // falsy -> the 90 fallback is used as the numerator
maxTurnsValue = 90;
assert.ok(Math.abs(agePace() - 1) < 1e-9, "a falsy paceReferenceTurns falls back to 90 (90/90 = 1)");
maxTurnsValue = 180;
assert.ok(Math.abs(agePace() - 0.5) < 1e-9, "...and the 90 fallback is the real numerator (90/180 = 0.5)");
CONFIG.paceReferenceTurns = 90;
maxTurnsValue = 90;

const savedScaleTable = CONFIG.mapSizeScale;
CONFIG.mapSizeScale = null; // falsy -> the {} fallback -> every size is unknown -> neutral
configImpl = { getMap: () => ({ mapSizeTypeName: "MAPSIZE_HUGE" }) };
assert.equal(mapSizeScale(), 1, "a missing mapSizeScale table falls back to {} -> neutral 1 (no throw)");
CONFIG.mapSizeScale = savedScaleTable;

// --- master toggle short-circuits both reads ---
CONFIG.calibrateToGameSettings = false;
maxTurnsValue = 300;
assert.equal(agePace(), 1, "disabled -> neutral pace (no read)");
assert.equal(mapSizeScale(), 1, "disabled -> neutral map scale (no read)");
CONFIG.calibrateToGameSettings = true;
maxTurnsValue = 90;

console.log("calibration-branches.mjs OK");
