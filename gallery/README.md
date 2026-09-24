# Gallery

Release imagery for the Workshop page and the GitHub release, captured in game by
`devtools/harness/cdh-game-suite.js`: it seeds a contested frontier, aims the camera at it and emits `SHOT <name>`,
and `run-harness.sh` grabs the game WINDOW by id (never the whole display) into `devtools/harness/shots/`.

| Image | What it shows |
| --- | --- |
| `01-cultural-pressure-lens.jpg` | The Cultural Pressure lens over a contested frontier north of Lāhainā, with a rival city on the far side. The shaded band is the tiles this culture is winning. Clean - no panels, no tooltips. The header image |
| `02-contested-frontier-close.jpg` | The same front close in, so the shading reads tile by tile against the terrain |
| `03-lens-in-the-lens-list.jpg` | The game's own Lenses panel with **Cultural Pressure** selected among Continent, Appeal, Prosperity, Settler, Trade, Ethnicity and Religion - the lens is a real entry in the game's list, not an overlay bolted on |

Full-resolution originals (about 11 MB each, 3024x1890) stay in `devtools/harness/shots/` and are gitignored; these
are 1600px JPEGs at quality 84.

## Capturing more

`zsh devtools/harness/run-harness.sh cdh-game-suite.js AugustusAnt136.Civ7Save suite 900`

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
  KEEPS its ring both look like an ordinary map.
