# Changelog

All notable changes to Cultural Diffusion are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the mod uses
[Semantic Versioning](https://semver.org/).

## [1.0.2] - 2026-07-06

Options-screen localization fix. No gameplay or balance changes.

### Fixed
- The mod's controls under the shared "Mods" Options tab now show their proper
  localized names rather than a raw `LOC_…` tag. Every label, description, and dropdown
  item resolves to a defined, mod-prefixed key in `text/en_us/ModText.xml`.

## [1.0.1] - 2026-07-04

Cross-mod compatibility and stability hardening so the mod coexists cleanly with
other players' mods. No gameplay or balance changes.

### Changed
- Turn-hook registration is now idempotent: the per-turn engine subscription is
  drained before it is re-registered, guaranteeing exactly one diffusion pass per turn
  even if the game scope re-runs the script within a session, and never stacking a
  duplicate handler on the engine event bus that other mods also use.

### Added
- Safety cutoff: after repeated internal errors the mod unsubscribes its own turn hook
  instead of retrying (and logging) every turn, so a fault can never spam the shared
  event bus. New `culturalDiffusion.stop()` console helper to unsubscribe on demand.
- Branded Workshop preview image.

## [1.0.0] - 2026-07-04

First public release. A reimagining and extension of the Civ V "Cultural Diffusion"
mod for Civilization VII.

### Added
- Reaction-diffusion culture field: cities inject culture into a persisted per-tile
  stock that diffuses to neighbours and decays each turn, so borders grow as a slow,
  organic travelling wave (ring 3 is a mid-game event; ring 5+ is a mature culture).
- Terrain shaping: culture follows roads and river valleys and is slowed or blocked
  crossing hills, mountains, tundra/desert biomes, and forest/jungle/marsh features.
- Fused injection strength: a geometric blend of culture with a prosperity/vitality
  aggregate, a per-civilization Cultural Power Index (wonders, great works, culture,
  influence, city-state suzerainties, happiness, golden ages, traditions, age), and a
  celebration bonus.
- Optional ethnic-affinity diffusion that reads the Emigration mod's diaspora data so
  borders follow people. Standalone-safe: neutral when Emigration is absent.
- Per-age tuning for Civ VII's three ages and game-settings calibration that paces the
  field to the current age length and nudges injection by map size.
- Bounded per-leader / civilization / memento balance layer for territory-redundant
  kits (e.g. culture-on-capture).
- Options: intensity presets (Low / Medium / High), enable switch, claim-empty-land-only
  safety mode, free-territory vs buy-with-gold verb, rich-cultural-model and
  follow-diaspora toggles, and debug logging.
- Single-player, flag-gated, reversible.
