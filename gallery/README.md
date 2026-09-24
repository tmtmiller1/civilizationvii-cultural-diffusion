# Gallery

Release imagery for the Workshop page and the GitHub release. Captured in game by
`devtools/harness/cdh-game-shots.js`, which seeds a contested frontier, aims the camera and emits `SHOT <name>`;
`run-harness.sh` grabs the game WINDOW by id (never the whole display) into `devtools/harness/shots/`.

| Image | What it shows |
| --- | --- |
| `01-cultural-pressure-lens.jpg` | The Cultural Pressure lens over a frontier north of Megiddo: the shaded tiles are the ones the mod's culture is winning. Wide, no UI panels |
| `02-cultural-pressure-lens-selected.jpg` | The same front closer in, with the game's own Lenses panel open and **Cultural Pressure** selected, so the lens is visibly one of the game's lenses |

Full-resolution originals (about 12 MB each, 3024x1890) stay in `devtools/harness/shots/` and are not committed;
these are 1600px JPEGs at quality 84, sized for a README and a Workshop page.

## Capturing more

`zsh devtools/harness/run-harness.sh cdh-game-shots.js AugustusAnt136.Civ7Save shots 900`

Two traps that cost a run each:

- **Do not run the pass after seeding.** The first attempt seeded culture, ran a pass, and the pass CLAIMED the very
  tiles meant to be photographed - a tile that is already ours is not contested, so the lens correctly painted
  nothing and the lens-on and lens-off frames came out identical. Seed BELOW the ownership bar instead.
- **Do not switch to `fxs-default-lens` for a clean map.** It is the game's default view and it turns on the YIELD
  ICON overlay, which buries the map in badges. Both attempts' first frame was spoiled that way.

A hue test cannot verify the lens: it paints in the civ's own banner colour, so lens paint and ordinary territory
count as the same pixels. Confirm from the frame itself - the lens is a flat translucent fill across whole tiles,
territory is a border line - or from the Lenses panel being open on Cultural Pressure.
