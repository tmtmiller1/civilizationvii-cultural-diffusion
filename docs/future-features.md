# Cultural Diffusion - Future Features / Roadmap

Backlog of features proposed for the Cultural Diffusion mod but **not yet built**.
Written to the same house style as `cultural-diffusion-spec.md`: flag-gated,
conservative defaults, reversible, single-player only, with file anchors so each
item is actionable when picked up. Nothing here ships until it has its own probe /
verification pass the way the core diffusion loop did.

Status legend: **PLANNED** (agreed, not started) - **IDEA** (needs design) - **DONE**.

---

## 1. Settings menu parity with the Emigration mod

**Status: MOSTLY DONE - polish/parity remaining.**

The mod *already* registers a settings surface under the shared **"Mods"** tab of the
Options screen, in both shell and game scopes - see
[`ui/cd-options.js`](../ui/cd-options.js) (state getters/setters in
[`ui/cd-settings.js`](../ui/cd-settings.js)). It currently exposes:

- Intensity preset (Custom / Low / Medium / High)
- Enable diffusion (master switch)
- Claim only unowned land (safety mode)
- Flip verb (Free territory / Buy with gold)
- Debug logging

Remaining work to reach true parity with Emigration's menu
([`emigration/ui/emigration-options.js`](../../emigration/ui/emigration-options.js)):

- Group the new gameplay toggles below (starting with **Tile ownership flip on
  conquest**, 2) under a clear sub-heading so the tab reads as a coherent panel.
- Mirror Emigration's convention of one persisted setting per option, defaulted OFF
  for anything that changes territory, with a localized label + tooltip per control.

Every new toggle proposed in this document is assumed to live in this same menu.

---

## 2. Tile ownership flip on conquest  **[PLANNED]**

### Summary

While you are **at war**, any plot your **military units occupy/control** flips
immediately to your territory - independent of cultural pressure. This models
territory changing hands by force, not just by slow cultural diffusion. It is applied
**after** all Emigration-related changes have resolved for that turn (see
**Ordering**, below), so migration and diffusion settle first and conquest is the
final territorial word for the turn.

### Behavior

- **Trigger:** the local player is at war with the plot's current owner
  (`atWar()` already exists in [`ui/cd-borders.js`](../ui/cd-borders.js)), and one of
  the local player's units occupies / controls that plot.
- **Effect:** the plot flips to the local player via the same mechanism the diffusion
  loop uses - `WorldBuilder.MapPlots.setOwnership(playerId, loc)`
  ([`ui/cd-ownership.js`](../ui/cd-ownership.js), `flipViaSetOwnership` /
  `performFlip`). Free-territory verb only (a conquered tile is not "purchased").
- **Immediacy:** unlike cultural flips, there is no multi-turn pressure threshold or
  `locked` cooldown - occupation this turn = ownership this turn.
- **Scope:** single-player only (`guardSP()`), like every other flip path.

### Toggle (Options)

- New boolean in the "Mods" tab: **"Flip occupied tiles during war"**
  (`id: "cd-conquest-flip"`), backed by a `getConquestFlip()/setConquestFlip()` pair
  in [`ui/cd-settings.js`](../ui/cd-settings.js) and `CONFIG.conquestFlip` in
  [`ui/cd-config.js`](../ui/cd-config.js).
- **Default: OFF.** It changes territory outside the cultural model, so it stays
  opt-in and reversible like the rest of the mod.

### Ordering (important)

The user requirement is that conquest flips apply **after** Emigration's per-turn
changes. Both mods run off `PlayerTurnActivated`. Concretely:

1. Emigration's per-turn pass runs (migration, dilemmas, integration/return).
2. Cultural Diffusion's `runPass()` runs its cultural flips
   ([`ui/cd-pass.js`](../ui/cd-pass.js)).
3. **New:** a conquest sweep runs *last* within the CD pass (or as a distinct
   post-step gated on `CONFIG.conquestFlip`), so occupation overrides any cultural
   or migration outcome for the turn.

Since CD already depends on / reads Emigration state
([`ui/cd-emigration.js`](../ui/cd-emigration.js)), the cleanest placement is a final
stage appended after `resolveOwnership()` inside the existing pass, guaranteeing it
observes the fully-settled board.

### Open questions / discovery needed

- **Units-on-tile API.** CD reads ownership via `GameplayMap.getOwner(x, y)`
  ([`ui/cd-plots.js`](../ui/cd-plots.js)) but does not yet enumerate units on a plot.
  Need to confirm the correct read (e.g. `MapUnits` / `Units.getUnitsAt` / a plot
  unit query) and what counts as "controlling" a tile - any military unit present,
  vs. a unit that has *sat* on it (to avoid a unit merely passing through flipping a
  tile mid-move). Recommend "military unit present at turn end."
- **Reversal on peace / retreat.** Decide whether conquered tiles stay flipped after
  the war ends or after the unit leaves. Simplest v1: they stay (a permanent gain),
  and normal cultural diffusion governs them afterward. Note this explicitly since it
  differs from historical "occupied vs. annexed" nuance.
- **City tiles / capitals.** Confirm we do not accidentally flip the plot under an
  enemy city (that is a capture event the base game owns). Likely exclude
  district/city-center plots.
- **Interaction with `locked` / core-protected tiles.** Decide precedence vs.
  `isCoreProtected` and the diffusion `locked` map - conquest should probably win,
  but state that intent.

### Verification

- Extend the in-game probe (`../probe/`) the same way the core loop was proven: enter
  a war, move a unit onto a rival frontier tile, confirm the tile flips **only** with
  the toggle ON, flips to the occupying player, and survives save/reload.

---

## 3. (reserved for future items)

Add new proposals below in the same shape: Summary - Behavior - Toggle - Ordering (if
turn-timing matters) - Open questions - Verification.
