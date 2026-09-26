# Gallery

Release imagery for the Workshop page and the GitHub release, captured in game by
`devtools/harness/cdh-game-suite.js`: it seeds a contested frontier, aims the camera at it and emits `SHOT <name>`,
and `run-harness.sh` grabs the game WINDOW by id (never the whole display) into `devtools/harness/shots/`.

| Image | What it shows |
| --- | --- |
| `01-cultural-pressure-lens.jpg` | The Cultural Pressure lens over a contested frontier north of Lāhainā, with a rival city on the far side. The shaded band is the tiles this culture is winning. Clean - no panels, no tooltips. The header image |
| `02-contested-frontier-close.jpg` | The same front close in, so the shading reads tile by tile against the terrain |
| `03-lens-in-the-lens-list.jpg` | The game's own Lenses panel with **Cultural Pressure** selected among Continent, Appeal, Prosperity, Settler, Trade, Ethnicity and Religion - the lens is a real entry in the game's list, not an overlay bolted on |

| `04-border-before.jpg` / `05-border-after.jpg` | The mod's EFFECT rather than its readout: one camera, held still, west of Leeds. In `04` the border runs down the middle of the frame with open land beyond it; in `05` that line has moved to the far west and the whole plain is inside the border. Verified by count, not by eye - Leeds' own tiles go from `[1,6,12,8,0,0,0]` by ring to `[1,6,12,8,7,7,0]`, so its footprint stops at the base game's ring 3 in `04` and holds fourteen tiles at rings 4 and 5 in `05` (owned within six rings, 49 to 74, across six passes) |

| `06-civilopedia-section.jpg` / `07-civilopedia-terrain-and-rivers.jpg` / `08-civilopedia-options.jpg` | The Civilopedia section added in 1.4.0: its front page with the full sidebar of groups and pages, a rules page, and the Options page. Captured by `devtools/harness/cdh-game-pedia.js` (run `pedia`) and cropped to the Civilopedia panel, 1300x1100. The runner's shot labels trail the page by one, so each frame was picked by what it shows |

Full-resolution originals (about 11 MB each, 3024x1890) stay in `devtools/harness/shots/` and are gitignored; these
are 1600px JPEGs at quality 84.

The border pair carries the game's yield icons; the lens shots do not. Which frames get them was never pinned down -
the badges appear in runs that call `LensManager` and in some that only read from it, and no setting for the Yields
decoration could be found in `AppOptions.txt` or `LocalStorage.sqlite`. If a clean border pair matters, take it by
hand with Decorations > Yields unchecked.

## Capturing more

Lens shots: `zsh devtools/harness/run-harness.sh cdh-game-suite.js AugustusAnt136.Civ7Save suite 900`

Border pair: `PATCH="ui/cd-settings.js|OPT_PRESSURE_LENS, true|OPT_PRESSURE_LENS, false" \`
`zsh devtools/harness/run-harness.sh cdh-game-borders6.js AugustusAnt136.Civ7Save borders6 900`

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
- **A "before" frame has to be measured, not assumed.** The first border pair was rejected for showing a city with
  four rings of territory when the base game stops at three. Count the owned tiles by ring, attributing each tile to
  its NEAREST city, and log the census beside the shot: Leeds reads `[1,6,12,8,0,0,0]`, which is a vanilla footprint,
  and `[1,6,12,8,7,7,0]` after, which is not.
- **Pick a city with no second empire in frame.** That rejected pair was not a claim gone wrong - every city in the
  save measured ring 3. It was a neighbouring civ's land, in a near-identical purple, reading as the subject city's.
  Count foreign-owned tiles within six rings and take the lowest: Lāhainā had **29**, Leeds had **1**.
- **Aim once for a pair.** Calling `Camera.lookAtPlot` again before the second shot does not land on the same view,
  and a pair that is not the same view is not a comparison. Aim, shoot, run the passes, shoot again, never re-aim.
- **Frame the frontier, not the city.** Centred on the city the border simply left the picture; centred on the land
  about to be claimed, the old border and the new one are both in shot and the line visibly moves.
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
- **Do not trust an early `LensManager.getActiveLens()` read, and remember the active lens SURVIVES a restart.**
  Suite shot 01 showed pressure paint while the run logged `lensAtStart=fxs-default-lens`, which read like the layer
  painting without its lens. It was not: the preceding run had left `cd-pressure-lens` active, the game restored it
  after the early read, and the frame was taken nine seconds later with the mod's lens genuinely on. Measured
  directly by `cdh-game-lenscheck.js` - untouched `layerEnabled=false` and a clean frame, lens active
  `layerEnabled=true` and a fully painted frame, switched away `layerEnabled=false` and a clean frame again, with
  `wouldPaint=9` throughout. The gating is correct; end a capture run on the default lens or the next one inherits
  yours.
