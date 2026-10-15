// tests/city-flip-data.mjs: the settlement-flip data (data/cd-city-flip.sql), run against an in-memory database with
// the tables it writes. Every EFFECT_CITY_TRANSFER_OWNER modifier must carry the team guard (an inverted
// REQUIREMENT_CITY_OWNER_IS_SAME_TEAM in its subject requirement set): unguarded, a RunOnce 0 transfer fires again
// on its new owner until the game crashes. The check is also run on a copy with the guard removed, to show it bites.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { markerFor } from "/cultural-diffusion/ui/cd-city-flip-rule.js";

const SQL = fs.readFileSync("data/cd-city-flip.sql", "utf8");

const SCHEMA = `
CREATE TABLE Leaders (LeaderType TEXT PRIMARY KEY, IsMajorLeader INTEGER);
CREATE TABLE Types (Type TEXT PRIMARY KEY, Kind TEXT);
CREATE TABLE Traits (TraitType TEXT PRIMARY KEY, InternalOnly INTEGER);
CREATE TABLE LeaderTraits (LeaderType TEXT, TraitType TEXT);
CREATE TABLE Constructibles (ConstructibleType TEXT PRIMARY KEY, Name TEXT NOT NULL, Description TEXT, Tooltip TEXT,
  ConstructibleClass TEXT NOT NULL, Cost INTEGER NOT NULL, Population INTEGER NOT NULL, ExistingDistrictOnly INTEGER,
  CanBeHidden INTEGER);
CREATE TABLE Buildings (ConstructibleType TEXT PRIMARY KEY, Movable INTEGER NOT NULL, Purchasable INTEGER, Town INTEGER,
  TraitType TEXT);
CREATE TABLE TypeTags (Type TEXT, Tag TEXT);
CREATE TABLE Constructible_ValidDistricts (ConstructibleType TEXT, DistrictType TEXT);
CREATE TABLE DynamicModifiers (ModifierType TEXT PRIMARY KEY, CollectionType TEXT, EffectType TEXT);
CREATE TABLE Requirements (RequirementId TEXT PRIMARY KEY, RequirementType TEXT, Inverse INTEGER NOT NULL DEFAULT 0);
CREATE TABLE RequirementArguments (RequirementId TEXT, Name TEXT, Value TEXT);
CREATE TABLE RequirementSets (RequirementSetId TEXT PRIMARY KEY, RequirementSetType TEXT);
CREATE TABLE RequirementSetRequirements (RequirementSetId TEXT, RequirementId TEXT);
CREATE TABLE Modifiers (ModifierId TEXT PRIMARY KEY, ModifierType TEXT, RunOnce INTEGER, Permanent INTEGER,
  SubjectRequirementSetId TEXT);
CREATE TABLE ModifierArguments (ModifierId TEXT, Name TEXT, Value TEXT);
CREATE TABLE TraitModifiers (TraitType TEXT, ModifierId TEXT);
INSERT INTO Leaders VALUES ('LEADER_PERICLES', 1), ('LEADER_HIMIKO', 1), ('LEADER_AMINA', 1), ('LEADER_MINOR_X', 0);
`;

/** Load the SQL into a fresh database. */
function load(sql) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(sql);
  return db;
}

/** The transfer modifiers whose subject requirement set lacks the inverted same-team requirement. */
function unguardedTransfers(db) {
  return db.prepare(`
    SELECT m.ModifierId AS id FROM Modifiers m JOIN DynamicModifiers d ON d.ModifierType = m.ModifierType
    WHERE d.EffectType = 'EFFECT_CITY_TRANSFER_OWNER' AND NOT EXISTS (
      SELECT 1 FROM RequirementSetRequirements rsr JOIN Requirements r ON r.RequirementId = rsr.RequirementId
      WHERE rsr.RequirementSetId = m.SubjectRequirementSetId
        AND r.RequirementType = 'REQUIREMENT_CITY_OWNER_IS_SAME_TEAM' AND r.Inverse = 1)`).all().map((r) => r.id);
}

test("data: every transfer modifier carries the team guard", () => {
  const db = load(SQL);
  const n = db.prepare(`SELECT COUNT(*) AS n FROM Modifiers m JOIN DynamicModifiers d ON d.ModifierType = m.ModifierType
    WHERE d.EffectType = 'EFFECT_CITY_TRANSFER_OWNER'`).get().n;
  assert.equal(n, 3, "one transfer modifier per major leader");
  assert.deepEqual(unguardedTransfers(db), []);
});

test("data: the guard check fails when the guard is missing", () => {
  const stripped = SQL.replace(/INSERT INTO RequirementSetRequirements[^;]*REQ_CD_FLIP_NOT_SAME_TEAM[^;]*;/, "");
  assert.notEqual(stripped, SQL, "the guard insert was found and removed");
  assert.equal(unguardedTransfers(load(stripped)).length, 3);
});

test("data: each leader's modifier fires for its own marker, every time, as a culture transfer", () => {
  const db = load(SQL);
  for (const leader of ["LEADER_PERICLES", "LEADER_HIMIKO", "LEADER_AMINA"]) {
    const mod = db.prepare("SELECT * FROM Modifiers WHERE ModifierId = ?").get(`MOD_CD_FLIP_${leader}`);
    assert.equal(mod.RunOnce, 0, "RunOnce 1 never fires for a marker placed later");
    assert.equal(db.prepare("SELECT TraitType FROM TraitModifiers WHERE ModifierId = ?").get(mod.ModifierId).TraitType,
      `TRAIT_CD_FLIP_${leader}`);
    assert.ok(db.prepare("SELECT 1 FROM LeaderTraits WHERE LeaderType = ? AND TraitType = ?").get(leader, `TRAIT_CD_FLIP_${leader}`));
    const arg = db.prepare("SELECT Value FROM ModifierArguments WHERE ModifierId = ? AND Name = 'TransferType'").get(mod.ModifierId);
    assert.equal(arg.Value, "BY_CULTURAL_IDENTITY");
    const building = db.prepare(`SELECT ra.Value AS v FROM RequirementSetRequirements rsr
      JOIN Requirements r ON r.RequirementId = rsr.RequirementId JOIN RequirementArguments ra ON ra.RequirementId = r.RequirementId
      WHERE rsr.RequirementSetId = ? AND r.RequirementType = 'REQUIREMENT_CITY_HAS_BUILDING' AND ra.Name = 'BuildingType'`)
      .get(mod.SubjectRequirementSetId);
    assert.equal(building.v, markerFor(leader), "the marker the script places is the one the modifier reads");
  }
});

test("data: markers exist only for major leaders, are never offered, and stand only in a city center", () => {
  const db = load(SQL);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM Buildings WHERE ConstructibleType LIKE 'BUILDING_CD_FLIP_%'").get().n, 3);
  assert.ok(!db.prepare("SELECT 1 FROM Buildings WHERE ConstructibleType = 'BUILDING_CD_FLIP_LEADER_MINOR_X'").get());
  const traits = db.prepare("SELECT DISTINCT TraitType AS t FROM Buildings WHERE ConstructibleType LIKE 'BUILDING_CD_FLIP_%'").all();
  assert.deepEqual(traits.map((r) => r.t), ["TRAIT_CD_FLIP_NONE"]);
  assert.ok(!db.prepare("SELECT 1 FROM LeaderTraits WHERE TraitType = 'TRAIT_CD_FLIP_NONE'").get(), "no leader has it");
  const b = db.prepare("SELECT * FROM Buildings WHERE ConstructibleType = 'BUILDING_CD_FLIP_LEADER_PERICLES'").get();
  assert.equal(b.Purchasable, 0);
  const c = db.prepare("SELECT * FROM Constructibles WHERE ConstructibleType = 'BUILDING_CD_FLIP_LEADER_PERICLES'").get();
  assert.equal(c.Population, 0);
  assert.equal(c.ExistingDistrictOnly, 1);
  const d = db.prepare("SELECT DistrictType FROM Constructible_ValidDistricts WHERE ConstructibleType = 'BUILDING_CD_FLIP_LEADER_PERICLES'").all();
  assert.deepEqual(d.map((r) => r.DistrictType), ["DISTRICT_CITY_CENTER"]);
});
