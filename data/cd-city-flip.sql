-- Whole-settlement flips (ui/cd-city-flip.js; mod_ideas_tested/liberation/cd-city-flip/SPEC.md §3).
--
-- One hidden marker building per major leader. When ui/cd-city-flip.js places BUILDING_CD_FLIP_<leader> in a
-- settlement's center, that leader's own trait modifier hands the settlement to the leader through the engine's
-- EFFECT_CITY_TRANSFER_OWNER (BY_CULTURAL_IDENTITY), which moves the center, every plot, the districts and the buildings
-- in one step. The script removes the marker as soon as the transfer arrives. Rows come from the Leaders table, so a
-- DLC or modded leader is covered. The buildings belong to a trait no civilization has, so they're never offered.
--
-- The guard: every transfer modifier also requires that the city's owner isn't on the modifier owner's team
-- (REQUIREMENT_CITY_OWNER_IS_SAME_TEAM, inverted). Without it a RunOnce 0 transfer fires again on its new owner until
-- the game crashes (stack overflow, watched 2 of 2 on 1.5.0). RunOnce 1 never fires for a marker placed later.
-- tests/city-flip-data.mjs fails if any transfer modifier here lacks the guard.

-- Traits: one per major leader, and one nobody has.
INSERT INTO Types (Type, Kind) SELECT 'TRAIT_CD_FLIP_' || LeaderType, 'KIND_TRAIT' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO Traits (TraitType, InternalOnly) SELECT 'TRAIT_CD_FLIP_' || LeaderType, 1 FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO LeaderTraits (LeaderType, TraitType) SELECT LeaderType, 'TRAIT_CD_FLIP_' || LeaderType FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO Types (Type, Kind) VALUES ('TRAIT_CD_FLIP_NONE', 'KIND_TRAIT');
INSERT INTO Traits (TraitType, InternalOnly) VALUES ('TRAIT_CD_FLIP_NONE', 1);

-- The marker buildings: free, no population, only in an existing city center, never built or bought.
INSERT INTO Types (Type, Kind) SELECT 'BUILDING_CD_FLIP_' || LeaderType, 'KIND_CONSTRUCTIBLE' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO Constructibles (ConstructibleType, Name, Description, Tooltip, ConstructibleClass, Cost, Population, ExistingDistrictOnly, CanBeHidden)
SELECT 'BUILDING_CD_FLIP_' || LeaderType, 'LOC_BUILDING_CD_FLIP_NAME', 'LOC_BUILDING_CD_FLIP_DESCRIPTION', 'LOC_BUILDING_CD_FLIP_TOOLTIP', 'BUILDING', 1, 0, 1, 1
FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO Buildings (ConstructibleType, Movable, Purchasable, Town, TraitType)
SELECT 'BUILDING_CD_FLIP_' || LeaderType, 0, 0, 1, 'TRAIT_CD_FLIP_NONE' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO TypeTags (Type, Tag) SELECT 'BUILDING_CD_FLIP_' || LeaderType, 'IGNORE_DISTRICT_PLACEMENT_CAP' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO Constructible_ValidDistricts (ConstructibleType, DistrictType)
SELECT 'BUILDING_CD_FLIP_' || LeaderType, 'DISTRICT_CITY_CENTER' FROM Leaders WHERE IsMajorLeader = 1;

-- The modifier type: give any city to the modifier's owner.
INSERT INTO Types (Type, Kind) VALUES ('MODIFIER_CD_CITY_FLIP', 'KIND_MODIFIER');
INSERT INTO DynamicModifiers (ModifierType, CollectionType, EffectType)
VALUES ('MODIFIER_CD_CITY_FLIP', 'COLLECTION_ALL_CITIES', 'EFFECT_CITY_TRANSFER_OWNER');

-- The guard, shared by every transfer modifier.
INSERT INTO Requirements (RequirementId, RequirementType, Inverse)
VALUES ('REQ_CD_FLIP_NOT_SAME_TEAM', 'REQUIREMENT_CITY_OWNER_IS_SAME_TEAM', 1);

-- Per leader: the city holds that leader's marker, and isn't on the leader's team.
INSERT INTO Requirements (RequirementId, RequirementType)
SELECT 'REQ_CD_FLIP_' || LeaderType, 'REQUIREMENT_CITY_HAS_BUILDING' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO RequirementArguments (RequirementId, Name, Value)
SELECT 'REQ_CD_FLIP_' || LeaderType, 'BuildingType', 'BUILDING_CD_FLIP_' || LeaderType FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO RequirementSets (RequirementSetId, RequirementSetType)
SELECT 'RS_CD_FLIP_' || LeaderType, 'REQUIREMENTSET_TEST_ALL' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO RequirementSetRequirements (RequirementSetId, RequirementId)
SELECT 'RS_CD_FLIP_' || LeaderType, 'REQ_CD_FLIP_' || LeaderType FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO RequirementSetRequirements (RequirementSetId, RequirementId)
SELECT 'RS_CD_FLIP_' || LeaderType, 'REQ_CD_FLIP_NOT_SAME_TEAM' FROM Leaders WHERE IsMajorLeader = 1;

-- Per leader: the transfer modifier, owned by the leader's trait.
INSERT INTO Modifiers (ModifierId, ModifierType, RunOnce, Permanent, SubjectRequirementSetId)
SELECT 'MOD_CD_FLIP_' || LeaderType, 'MODIFIER_CD_CITY_FLIP', 0, 1, 'RS_CD_FLIP_' || LeaderType FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO ModifierArguments (ModifierId, Name, Value)
SELECT 'MOD_CD_FLIP_' || LeaderType, 'TransferType', 'BY_CULTURAL_IDENTITY' FROM Leaders WHERE IsMajorLeader = 1;
INSERT INTO TraitModifiers (TraitType, ModifierId)
SELECT 'TRAIT_CD_FLIP_' || LeaderType, 'MOD_CD_FLIP_' || LeaderType FROM Leaders WHERE IsMajorLeader = 1;
