# Civ7 Settlement Distance vs. Workable Tile Range — Investigation & Findings

**Status: CLOSED (2026-07-22).** Definitive, multi-source investigation into what drives (A) the minimum
settlement distance and (B) the workable/developable tile range (the "3-ring wall") in Civilization VII, and
whether either can be extended by a mod. Written because the Cultural Diffusion "usable outer-ring tiles"
feature hinges on (B), and weeks were burned on plausible-but-wrong theories about it.

> **TL;DR.** The two are **different systems**. **Settlement distance is a moddable `GlobalParameters` value
> (`CITY_MIN_RANGE`, default 3).** **The workable tile range is NOT moddable** — it is computed in the native
> C++ engine, fed by parameters that are either inert or unrelated, with no data lever and no JS input. The
> only time anyone ever extended the work radius in this franchise (Civ6's "Workable 4th Ring") did it by
> **replacing the engine DLL**, which Civ VII does not allow. Do not attempt to lift the 3-ring work cap via
> data — it cannot be done on the current modding surface.

---

## 1. The core distinction (the thing everyone conflates)

- **Settlement distance / "min city range"** = how far apart two settlement centers must be when founding a new
  city or town. Driven by `CITY_MIN_RANGE`. **Moddable.**
- **Workable / developable tile range** = how far from a city center a player can *work / develop* tiles (place
  rural improvements, build urban districts). Capped at **~3 hexes**. **Native / hard-coded. Not moddable.**

These are independent concepts, but because `CITY_MIN_RANGE` is the only obviously-named "range" parameter,
it gets mistaken for the work-radius lever. It is not. (This mistake cost this project real time — see the
`Larger Borders`/`N Tiles Min City Range` confusion below.)

---

## 2. System A — Settlement distance: `CITY_MIN_RANGE` (moddable)

**Driver:** the `CITY_MIN_RANGE` `GlobalParameters` row (default **3**), enforced by native code.

**Evidence:**

- Base-game code — the *only* JavaScript that reads `CITY_MIN_RANGE` is map generation, not live founding:
  `base-standard/maps/assign-advanced-start-region.js:37` — `GameInfo.GlobalParameters.lookup("CITY_MIN_RANGE")`
  then `GameplayMap.getPlotIndicesInRadius(...minRange)` to reserve a radius around each start. Comment: *"depending
  on how close you can settle (normally 3)."*
- Live founding validity is a native operation with no JS distance check:
  `base-standard/ui/interface-modes/interface-mode-found-city-adjacent-plot.js:11-18` calls
  `Game.UnitOperations.canStart(unitID, "UNITOPERATION_FOUND_CITY_ADJACENT_PLOT", ...)` and just paints
  `result.Plots`. `CITY_MIN_RANGE` is consumed inside that native `canStart` path (C++).
- It appears **only** as a `GlobalParameters` row — no Requirement, Modifier, or other DB table references it
  (verified against a full `.dump` of the compiled `gameplay-copy.sqlite`).
- The mod authors confirm it is spacing only. Enio/DoGGstor, asked directly whether their mod affects
  tile/improvement placement at distance, answered it is **"just where you can settle."**

**Moddable via:** a per-age `GlobalParameters` override (the gameplay DB rebuilds each age, so apply it to
Antiquity/Exploration/Modern). This is exactly what the "N Tiles Min City Range" mods do — they change this one
value (3 -> 4 or 5) and nothing else.

Reference mods (all identical mechanism, settlement spacing only):

- [5 Tiles City Range (Enio, CivFanatics)](https://forums.civfanatics.com/resources/5-tiles-city-range.32278/) —
  *"Settlement can be founded 5 tiles from each other."*
- [4 Tiles Min City Range (Enio, CivFanatics)](https://forums.civfanatics.com/resources/4-tiles-min-city-range.32286/)
- [4 Tiles Min City Range (DoGGstor, Steam Workshop)](https://steamcommunity.com/sharedfiles/filedetails/?id=3578252971) —
  *"adjusts the minimum city placement distance."*
- [5 Tiles Min City Range V2 (Enio, Steam Workshop)](https://steamcommunity.com/sharedfiles/filedetails/?id=3509594994)
- [CIVILIZATION 7 MIN CITY RANGE thread](https://forums.civfanatics.com/threads/civilization-7-min-city-range.697286/) ·
  [Min City Distance?](https://forums.civfanatics.com/threads/min-city-distance.695170/) ·
  [Setting city min distance limit](https://forums.civfanatics.com/threads/setting-city-min-distance-limit.657829/)

Copies of two of these mods are archived under `other_peoples_mods/4-tiles-min-city-range/` (deleted) and
`other_peoples_mods/enio-5-tiles-min-city-range-v2/`.

---

## 3. System B — Workable tile range: native, NOT moddable

**Driver:** purely native C++. The UI only *paints* plot sets the engine returns; no radius, ring count, age
value, or parameter is present anywhere in the readable path.

**Base-game code evidence:**

- Expand/develop plots (rural improvements, urban placement):
  `base-standard/ui/place-population/model-place-population.js:89-113` —
  `const result = Game.CityCommands.canStart(id, CityCommandTypes.EXPAND, {}, false)`; the UI iterates
  `result.Plots`. The geometry is decided inside native `canStart`.
- Workable specialist plots: `base-standard/ui/plot-workers/plot-workers-manager.js:112` —
  `city.Workers.GetAllPlacementInfo()` (native).
- `interface-mode-acquire-tile.js` merely consumes those (`PlacePopulation.getExpandPlotsIndexes()`,
  `PlotWorkersManager.workablePlotIndexes`) and draws overlays. No range logic.
- None of the candidate range parameters (`CITY_MAX_BUY_PLOT_RANGE`, `CITY_EXTENDED_CLAIM_RANGE`,
  `PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE`, `LAND_CLAIM_*`, `CULTURE_COST_*`) appears in **any** base-game `.js`
  (grep confirmed) — they are read only by native C++.

**Community evidence (Civ7-specific) — modders who tried and failed:**

- [Mod to increase city size (CivFanatics, Civ7)](https://forums.civfanatics.com/threads/mod-to-increase-city-size.695723/)
  is the definitive thread. Modder **IanMoon33**, after deep reverse engineering:
  - *"The 3 tile range seems to be hard-coded into a packed file."*
  - *"Without a way to actually link the plot to the parent city object, a mod like this will never work sadly."*
  - On the exact param we tried: *"city max buy plot range doesn't work."*
  - On the land-claim params: *"Setting `LAND_CLAIM_MAX_RANGE` to anything greater than -1 seems to make it
    impossible to place down a city or town at all."*
  - Critically: you can *cosmetically* fake tile ownership past ring 3, but the tiles **"remain non-functional
    for yields, improvements, or districts"** — the plot->city linkage lives in private compiled classes.
- [Settlement maximum radius (CivFanatics)](https://forums.civfanatics.com/threads/settlement-maximum-radius.693922/) —
  *"You can't grab the 4th ring tiles in Civ 7."* Only civ-specific exception: America's modern **Prospector**
  unit claims a resource a 4th ring out.
- [Distance between cities (CivFanatics)](https://forums.civfanatics.com/threads/distance-between-cities.694599/) —
  the 3-tile citizen-work radius *"is hardcoded, rather than an intentional design choice."*
- [Official Steam Civ7 discussion](https://steamcommunity.com/app/1295660/discussions/0/598519066984974902/) —
  *"there isn't any mechanic in this game that enables border growth beyond the 3 tile radius from a city."*

**Our own in-game test agreed:** raising `CITY_MAX_BUY_PLOT_RANGE` / `CITY_EXTENDED_CLAIM_RANGE` /
`PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE` to 6 (confirmed applied in the live DB, no rollback) produced **zero** change
to the buildable ring — the player still could not build past ring 3.

---

## 4. GlobalParameters reference (defaults from the compiled DB)

| Parameter | Base value | What it actually controls | Moddable for work range? |
| --- | --- | --- | --- |
| `CITY_MIN_RANGE` | 3 | Minimum settlement spacing (founding distance). | No — it's spacing, not working. |
| `CITY_MAX_BUY_PLOT_RANGE` | 3 | Gold-**purchase** plot range (Civ6 carryover). Reported **inert** in Civ7. | No. |
| `CITY_EXTENDED_CLAIM_RANGE` | 5 | Civ7-exclusive, **undocumented**; native-read. Best inference: extended/special claim cap. | Unverified; no evidence it lifts the work cap. |
| `PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE` | 5 | Max distance culture/influence can acquire (own) a plot. | No — governs owning/claiming, not the 3-ring work cap. |
| `LAND_CLAIM_MAX_RANGE` / `_STEPS` / `_RANGE_PER_STEP` | -1 / 1 / 2 | The **Diplomacy** "Land Claim" endeavor + commander charged ability (see #5). | No — unrelated; editing breaks city placement. |
| `CULTURE_COST_FIRST_PLOT` / `_LATER_PLOT_MULTIPLIER` / `_LATER_PLOT_EXPONENT` | 10 / 6 / 1.3 | Culture **cost curve** to claim the next plot (scales with distance). | No — cost, not range cap. |

Confirmed via the live `GlobalParameters` table in
`~/Library/Application Support/Civilization VII/Debug/gameplay-copy.sqlite` (schema is `(Name TEXT, Value TEXT)`
— there is **no** description column and **no** `CITY_WORK_RANGE` row). Cross-checked against the community Civ7
param dump [Seth9976/Civilopedia_Java](https://github.com/Seth9976/Civilopedia_Java)
(`databases/Civ7*/GlobalParameters.json`).

---

## 5. The three resolved "unknowns"

### 5.1 `LAND_CLAIM_*` -> the Diplomacy "Land Claim" endeavor (resolved, from the DB)

The compiled DB shows a full `DIPLOMACY_ACTION_LAND_CLAIM` (`LOC_DIPLOMACY_ACTION_LAND_CLAIM_NAME`,
support/oppose with influence via `PLAYER_DIPLOMACY_SUPPORT/OPPOSE_LAND_CLAIMS_*`, `dip_endeavors` icon) **and**
a `CHARGED_ABILITY_LAND_CLAIM` granted to **Legatus** and **Pirate Republic fleet-commander** units
(`LEGATUS_MOD_GRANT_LAND_CLAIM_CHARGE`, `MOD_CIV_PIRATE_REPUBLIC_FLEET_COMMANDER_LAND_CLAIM_CHARGE`), plus
`EFFECT_START_LAND_CLAIM` / `EFFECT_COMPLETE_LAND_CLAIM` modifiers and a `RegionClaimObstacles` table.

So `LAND_CLAIM_MAX_RANGE`(-1 = unbounded) / `_STEPS`(1) / `_RANGE_PER_STEP`(2) govern how far a **diplomatic /
commander land grab** reaches across the map. **Nothing to do with city tile-working.** Setting `MAX_RANGE > -1`
tangles with founding/claim validity, which is why testers found cities became unplaceable.

### 5.2 `CITY_MAX_BUY_PLOT_RANGE` -> gold-purchase range; does NOT drive working (resolved)

Civ6 semantics: gold-purchase-plot range. A Civ6 modder's own comment:
`UPDATE GlobalParameters SET Value=6 WHERE Name='CITY_MAX_BUY_PLOT_RANGE'; -- Buying City plot range default = 3`
([theangeloumali/AngeloDGreat_Civ6_Mods](https://github.com/theangeloumali/AngeloDGreat_Civ6_Mods)).

The mod cited as proof it extends *working* — **"Workable 4th Ring"** (PhantomJ_M) — I pulled its files. It sets
`CITY_MAX_BUY_PLOT_RANGE=4` **and ships three replacement engine DLLs**:

```
Binaries/Win64/GameCore_Base_Mod_FinalRelease.dll
Binaries/Win64/GameCore_XP1_Mod_FinalRelease.dll
Binaries/Win64/GameCore_XP2_Mod_FinalRelease.dll
```

(`workable_4th_ring/Workable4thRing.modinfo` loads them via `<File>` entries —
[luul11/luke_CivilizationVI_mods](https://github.com/luul11/luke_CivilizationVI_mods).) So even in Civ6,
extending the work radius required **patching the compiled C++ engine** — the parameter alone did nothing.
An experienced Civ6 modder (LeeS) stated it plainly on
[City Workable Plot Range](https://forums.civfanatics.com/threads/city-workable-plot-range.603963/): *"there is
no separate parameter for workable tile range, so it all appears to be locked up and hard-coded in the game's
dll,"* and that editing `CITY_MAX_BUY_PLOT_RANGE` *"has no actual alteration in-game."*

Civ7 has **no replaceable engine DLL / no GameCore source**, so there is no equivalent path. `CITY_MAX_BUY_PLOT_RANGE`
is confirmed inert for working in Civ7.

### 5.3 `CITY_EXTENDED_CLAIM_RANGE` -> Civ7-exclusive, undocumented (honest partial)

GitHub code search returns **zero** non-Civ7 references — it does not exist in any Civ6 source, so there is no
legacy definition to lean on. It appears **only** as a `GlobalParameters` row (value 5), read solely by native
C++, with **no description** in the Civ7 param dump or any modder documentation. By name and value (5, paired
with `PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE=5`) it most plausibly caps an **extended/special territory claim reach**
in native code (candidates: influence-border headroom, or the America-Prospector 4th-ring resource grab). This is
the one item that **cannot be fully confirmed without an isolated in-game test** (change it alone, watch
borders/claims). Verdict: undocumented native param, best-inference "extended-claim cap," not confirmed to affect
the work cap.

---

## 6. How Civ7 tile working actually works (for context)

- **Borders grow via Food-driven *growth events*** — not Culture (Civ5/6) and not one-tile gold-buys as the
  primary mechanic. Enough Food -> a growth event -> assign a Population to improve a tile, which claims all
  adjacent unowned tiles within the 3-hex cap (culture-bomb style). Districts/Wonders also claim adjacent tiles.
  ([Borders (Civ7) — Fandom](https://civilization.fandom.com/wiki/Borders_(Civ7)),
  [well-of-souls Civ7 Analyst](https://well-of-souls.com/civ/civ7_cities.html))
- **The 3-hex cap bounds BOTH owning and working.** Unlike Civ6, Civ7 has no farther "ownership ring" beyond the
  work radius — you cannot claim a 4th ring at all (barring the America Prospector exception).
  ([Settlement maximum radius](https://forums.civfanatics.com/threads/settlement-maximum-radius.693922/))
- **Owning != yielding.** A claimed-but-unimproved tile gives no yield; only tiles improved into a **Rural
  District** (or worked by a specialist in an **Urban District**) yield. Population is *permanently* assigned to a
  tile (no movable citizens). ([well-of-souls Analyst](https://well-of-souls.com/civ/civ7_cities.html),
  [Game8 Rural/Urban](https://game8.co/games/Civ-7/archives/498399))
- Urban districts must be placed adjacent to existing urban tiles/the City Center; rural improvements require a
  tile that is within borders, rural, and unimproved.
  ([District (Civ7) — Fandom](https://civilization.fandom.com/wiki/District_(Civ7)))
- Official terminology is **borders / growth / districts (rural/urban)** — "workable range", "city radius", and
  "expansion range" are community/legacy phrasings, not in-game terms.

---

## 7. What IS achievable vs. not

**Achievable via data mods:**

- Change **settlement spacing** (`CITY_MIN_RANGE`).
- Extend **culture-claim ownership range** (`PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE`) — *note:* Civ7-effect
  unverified; the "Larger Borders (Unlimited)" mods that raise it are **Civ6**, and Civ7 caps owning at 3, so this
  likely does little in Civ7.
- Boost **yields on tiles a city already works** (within 3 rings) via GameEffects/Modifiers targeting
  `COLLECTION_CITY_PLOT_YIELDS`.
- Force-**claim ownership** of tiles past ring 3 (e.g. `city.purchasePlot` — what Cultural Diffusion does) — but
  per IanMoon33 these are **cosmetic/non-functional** (no yields/improvements/districts).

**NOT achievable on the current modding surface:**

- Extending the **workable/developable** tile radius beyond 3 rings. Hard native limit; the only franchise
  precedent required replacing the engine DLL, which Civ7 does not permit. Wait for an official modding toolkit /
  source access.

---

## 8. Implication for Cultural Diffusion

- The "usable outer-ring tiles — work/settle beyond ring 3" feature (`workOuterTiles` / promote-to-worked) is
  **not buildable** — it belongs in [`wont-build-with-justifications.md`](wont-build-with-justifications.md), same
  compiled-engine wall as the archived emigration buildable-enclave.
- Cultural Diffusion force-claims tiles via `purchasePlot` beyond ring 3; per this research those tiles are very
  likely **cosmetic ownership only** (non-yielding), which the mod's own `Q-OUTER-YIELD` probe is consistent with
  (it never observed a yield on a far claimed tile).
- The `data/cd-work-range.xml` `GlobalParameters` override (`CITY_MAX_BUY_PLOT_RANGE`/`CITY_EXTENDED_CLAIM_RANGE`/
  `PLOT_INFLUENCE_MAX_ACQUIRE_DISTANCE = 6`) achieves nothing reliable for working and should be reverted.
  `CITY_MIN_RANGE` is the only knob there with a real effect (settlement spacing).

---

## 9. Methodology (how this was determined)

- **Local ground truth:** grepped the entire base-game JS tree
  (`.../Sid Meier's Civilization VII/CivilizationVII.app/Contents/Resources/Base/modules`); dumped and queried the
  live compiled gameplay DB (`.../Civilization VII/Debug/gameplay-copy.sqlite`) — `GlobalParameters`,
  `DiplomacyActions`, `ModifierArguments`, `DynamicModifiers`, `Types`.
- **Mod source:** copied and read the Enio/DoGGstor spacing mods; fetched the Civ6 "Workable 4th Ring" mod files
  via `gh` (GitHub CLI code search + `gh api` file contents) after Fandom returned HTTP 402.
- **In-game:** deployed a `GlobalParameters` override, confirmed it applied in the live DB, tested building
  outward — no change past ring 3.
- **Community:** CivFanatics threads (primary modder statements), the official Steam Civ7 discussion, and gameplay
  wikis (well-of-souls Analyst, Fandom, Game8).

---

## 10. Sources

**Civ7 primary (the definitive ones):**

- [Mod to increase city size — CivFanatics](https://forums.civfanatics.com/threads/mod-to-increase-city-size.695723/)
  (IanMoon33's reverse-engineering — the key thread)
- [Settlement maximum radius — CivFanatics](https://forums.civfanatics.com/threads/settlement-maximum-radius.693922/)
- [Distance between cities — CivFanatics](https://forums.civfanatics.com/threads/distance-between-cities.694599/)
- [Official Steam Civ7 discussion (border radius)](https://steamcommunity.com/app/1295660/discussions/0/598519066984974902/)
- [CIVILIZATION 7 MIN CITY RANGE — CivFanatics](https://forums.civfanatics.com/threads/civilization-7-min-city-range.697286/)
- [City Distance Increased Mod — CivFanatics](https://forums.civfanatics.com/threads/city-distance-increased-mod-easy-to-customise.695370/)
- [Modding discoveries — CivFanatics](https://forums.civfanatics.com/threads/modding-discoveries.694816/)

**Mods:**

- [5 Tiles City Range (Enio)](https://forums.civfanatics.com/resources/5-tiles-city-range.32278/) ·
  [4 Tiles Min City Range (Enio)](https://forums.civfanatics.com/resources/4-tiles-min-city-range.32286/)
- [4 Tiles Min City Range (DoGGstor, Steam)](https://steamcommunity.com/sharedfiles/filedetails/?id=3578252971) ·
  [5 Tiles Min City Range V2 (Enio, Steam)](https://steamcommunity.com/sharedfiles/filedetails/?id=3509594994)
- [Workable 4th Ring (PhantomJ_M) — luul11/luke_CivilizationVI_mods](https://github.com/luul11/luke_CivilizationVI_mods)
  (Civ6 — the DLL-based precedent)

**Civ6 context (for the carryover params):**

- [City Workable Plot Range — CivFanatics](https://forums.civfanatics.com/threads/city-workable-plot-range.603963/)
  (LeeS: hard-coded in the DLL)
- [Increase Workable Tile Radius — CivFanatics](https://forums.civfanatics.com/threads/increase-workable-tile-radius.611402/)
- [theangeloumali/AngeloDGreat_Civ6_Mods](https://github.com/theangeloumali/AngeloDGreat_Civ6_Mods)
  ("Buying City plot range default = 3")

**Data / tooling:**

- [Seth9976/Civilopedia_Java](https://github.com/Seth9976/Civilopedia_Java) (Civ7 `GlobalParameters.json` dump)
- [izica/civ7-modding-tools](https://github.com/izica/civ7-modding-tools) ·
  [mateicanavra/civ7-modding-tools](https://github.com/mateicanavra/civ7-modding-tools)

**Gameplay mechanics:**

- [Borders (Civ7) — Fandom](https://civilization.fandom.com/wiki/Borders_(Civ7)) ·
  [District (Civ7) — Fandom](https://civilization.fandom.com/wiki/District_(Civ7)) ·
  [Tile improvement (Civ7) — Fandom](https://civilization.fandom.com/wiki/Tile_improvement_(Civ7))
- [well-of-souls — Civ7 Analyst: Cities](https://well-of-souls.com/civ/civ7_cities.html) ·
  [Game8 — Rural/Urban Districts](https://game8.co/games/Civ-7/archives/498399) ·
  [Gamerant — Quarter/District explained](https://gamerant.com/civilization-7-quarter-district-rural-urban-explained/)
- [Official 2K Game Guide — Developing Settlements](https://civilization.2k.com/civ-vii/game-guide/gameplay/developing-settlements/)
  (referenced; fetch blocked 402/403)

**Local ground-truth files:**

- Base game code: `base-standard/ui/place-population/model-place-population.js` (89-113),
  `base-standard/ui/plot-workers/plot-workers-manager.js` (112),
  `base-standard/ui/interface-modes/interface-mode-acquire-tile.js`,
  `base-standard/ui/interface-modes/interface-mode-found-city-adjacent-plot.js` (11-18),
  `base-standard/maps/assign-advanced-start-region.js` (37).
- Compiled DB: `~/Library/Application Support/Civilization VII/Debug/gameplay-copy.sqlite`.
