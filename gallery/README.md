# Gallery

Release imagery for the Workshop page and the GitHub release, captured in game by
`devtools/harness/cdh-game-suite.js`: it seeds a contested frontier, aims the camera at it and emits `SHOT <name>`,
and `run-harness.sh` grabs the game WINDOW by id (never the whole display) into `devtools/harness/shots/`.

| Image | What it shows |
| --- | --- |
| `01-cultural-pressure-lens.jpg` | The Cultural Pressure lens over a contested frontier north of Lāhainā, with a rival city on the far side. The shaded band is the tiles this culture is winning. Clean - no panels, no tooltips. The header image |
| `02-contested-frontier-close.jpg` | The same front close in, so the shading reads tile by tile against the terrain |
| `03-lens-in-the-lens-list.jpg` | The game's own Lenses panel with **Cultural Pressure** selected among Continent, Appeal, Prosperity, Settler, Trade, Ethnicity and Religion - the lens is a real entry in the game's list, not an overlay bolted on |

| `04-border-before.jpg` / `05-border-after.jpg` | The mod's EFFECT rather than its readout: the same view of Lāhainā before and after culture claims the frontier. In `04` a border runs across the upper third with neutral land beyond it; in `05` that line is gone and the ground north-east of the city is inside the border. Verified by count, not by eye - owned tiles within six rings went from **33 to 62** across four passes |

Full-resolution originals (about 11 MB each, 3024x1890) stay in `devtools/harness/shots/` and are gitignored; these
are 1600px JPEGs at quality 84.

The border pair carries the game's yield icons; the lens shots do not. Which frames get them was never pinned down -
the badges appear in runs that call `LensManager` and in some that only read from it, and no setting for the Yields
decoration could be found in `AppOptions.txt` or `LocalStorage.sqlite`. If a clean border pair matters, take it by
hand with Decorations > Yields unchecked.

## Capturing more

Lens shots: `zsh devtools/harness/run-harness.sh cdh-game-suite.js AugustusAnt136.Civ7Save suite 900`

Border pair: `PATCH="ui/cd-settings.js|OPT_PRESSURE_LENS, true|OPT_PRESSURE_LENS, false" \`
`zsh devtools/harness/run-harness.sh cdh-game-borders.js AugustusAnt136.Civ7Save borders 900`

The `PATCH` hook edits one DEPLOYED file, never the repo. The border pair needs it because the pressure lens's
default lives in `cd-settings.js`, not in `cd-config.js`, and the lens fill would otherwise cover the border line -
and because disabling the layer through `LensManager` instead redraws the yield-icon overlay.

### What works

- **Seed BELOW the ownership bar and never run a pass.** A claimed tile is not contested, so the lens correctly
  paints nothing. An early attempt seeded high, ran a pass, and produced lens-on and lens-off frames that measured
  1.44% and 1.47% coloured pixels - identical.
- **Log what the lens would paint before shooting.** `pressureTiles().length` at seed time (`LENS would paint N`)
  is the one check that tells you a capture is worth taking. Two runs were wasted before it existed.
- **Aim AT the subject.** Run 11's recipe aims four columns east to dodge centred pop-ups, which is right for a
  pop-up shot and wrong for a lens shot - it put the paint in the corner of every early frame.
- **Verify by looking.** A hue test cannot check the lens: it paints in the civ's own banner colour, so lens paint
  and ordinary territory are the same pixels. Judge from the frame - the lens is a flat translucent fill across
  whole tiles, territory is a border line.

### What does not work from the harness

- `ContextManager.push("lens-panel")` and `ContextManager.push("screen-options")` both THREW. The Lenses panel in
  `03-...` appeared by accident during an earlier run, not by request. An Options screenshot needs the push to come
  from the MOD's own context (see `civilization_vii_mods/engine-closed.md` on Options probing), or to be taken by
  hand while playing.
- A shot of the hover readout needs a real cursor over a seeded tile; the harness never moves the mouse, so the
  tooltips visible in some frames are whatever the pointer happened to rest on.
- The two headline fixes in 1.2.0 are close to unphotographable: a unit that is NOT trapped and a city-state that
  KEEPS its ring both look like an ordinary map. The border pair is the closest thing to showing what the mod DOES.
- **The Cultural Pressure layer paints whenever it is enabled, not only when its lens is the active one.** Suite shot
  01 showed the paint before any lens call. Worth checking against shipped behaviour: a player with another lens
  selected may still see the shading.
