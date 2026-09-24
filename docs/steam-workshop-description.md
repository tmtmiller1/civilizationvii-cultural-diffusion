[h1]Cultural Diffusion[/h1]

[i]Cultural Diffusion[/i] turns your civilization's [b]cultural pressure[/b] into a living field that spreads from your cities tile by tile. A strong, established civilization grows its borders past the normal city footprint into open land, and can flip a rival's frontier tiles once its pressure there decisively wins — a systemic answer to AI forward-settling. Growth is slow: borders creep outward over the game, an overwhelming civilization reaches farther, and with the opt-in recede mode a rival whose pressure overtakes yours can take claimed tiles back.

[i]On terms: “cultural pressure” is this mod's own per-tile quantity, [b]not[/b] the base game's Culture yield. Culture is one input that feeds it, alongside a city's prosperity and your Cultural Power Index.[/i]

A reimagining and extension of Gedemon's [b]Cultural Diffusion[/b] mod for Civilization V, rebuilt for Civ VII with a deeper cultural-power model. It runs in single-player only, is fully tunable, and can be switched off at any time. It works standalone, and reads diaspora data from the [b]Emigration[/b] mod when that is installed.

Like its companion [b]Emigration[/b], this mod is a work in progress: balance is still being tuned, and nearly every system can be adjusted in Options. Feedback on how borders feel at each intensity is very welcome.

[h2]How it works — a pressure field, not a border calculation[/h2]

Every frontier tile remembers how much cultural pressure each civilization has deposited on it. Once per turn, over a bounded region around your cities, four things happen: cities [b]inject[/b] pressure into their own tile on a self-amplifying curve; it [b]diffuses[/b] outward, following roads and river valleys, slowed or blocked by hills, mountains and rough terrain; every tile slowly [b]decays[/b], the brake that keeps growth stable and lets pressure ebb when a city weakens; and ownership is read off the stock — a tile [b]flips[/b] to you once your pressure is largest there, clears an absolute floor and (when taking it from a rival) beats theirs by a decisive ratio, while staying contiguous with land you own. A rival's downtown ring is never taken.

Because pressure must build up ring by ring against decay, reach is an emergent travelling wave, not a distance formula. Your cities' first three rings are left to the base game; the mod claims only beyond them. In test games a strong city claimed its fourth ring about twenty turns after the mod started; farther rings belong to an entrenched civilization. Early on, expect nothing for a long while — in a 70-turn test game a capital making 8 Culture claimed no tiles. The mod matters most from the mid-game onward.

[h2]What Cultural Diffusion does[/h2]

[list]
[*]Cities pump cultural pressure into a persisted per-tile stock (a reaction-diffusion field) that diffuses to neighbours and decays each turn, so borders grow as a slow travelling wave rather than snapping to a radius.
[*]Terrain shapes the spread: pressure follows roads and river valleys, and is slowed or blocked crossing hills, mountains, tundra and desert, and forest, jungle and marsh.
[*]It answers AI forward-settling. A confident civilization claims the buffer around its cities and can take a rival's frontier tiles where its pressure clearly wins, so growing your border is the deterrent.
[*]Reach comes from cultural power, not raw Culture yield. Injection strength blends a city's Culture with a prosperity aggregate, a per-civilization Cultural Power Index (wonders, great works, Influence, suzerainties, happiness, golden ages, traditions, age) and a celebration bonus, so a prosperous, entrenched city reaches farther while a lone +Culture spike is diluted rather than a multiplier.
[*]Growth leaves room for its neighbours. A claim leaves another civilization's unit a legal move, so nobody at peace with you is sealed inside your borders; the tile is taken once that unit moves on. City-states and villages keep a protected ring, so pressure cannot reduce a minor to one tile.
[*]With Emigration installed, optional ethnic-affinity diffusion reads its diaspora data so pressure flows toward tiles your people settled; it is neutral when Emigration is absent, so the mod stays standalone-safe.
[*]Per-age tuning plus game-settings calibration re-times the field to the age length and nudges injection by map size, so the border arc holds across game speeds.
[*]A per-leader, civ and memento tuning table damps territory-redundant kits (e.g. Culture-on-capture) and lifts Culture-poor civs, so no single kit snowballs.
[*]A [b]Cultural Pressure lens[/b] (Shift+C) shades contested tiles by how close they are to changing hands, with a hover readout of each civilization's pressure and a turns-to-flip estimate. Only tiles genuinely on their way to changing hands are shaded; elsewhere the readout shows the pressures without a countdown.
[/list]

[i]Full formulas and tunables are documented in the README.[/i]

[h2]Tuning[/h2]

One intensity knob: [b]Low[/b] (a gentle nudge into empty land only), [b]Medium[/b] (default; contests rival frontier tiles) and [b]High[/b] (assertive; spreads farther, flips faster). Separate settings cover the master enable, an empty-land-only safety mode, how much of a rival's city ring is protected, contiguous borders, the “+1 ring” improvement buffer and receding borders (both off by default), the cultural-power model, follow-diaspora, the lens and debug logging. Every field, terrain, injection, calibration and per-age value is overridable.

[h2]It changes real tile ownership[/h2]

Tile ownership physically changes through real gameplay writes each turn — this is not a UI overlay. Claimed tiles lie beyond your cities' first three rings, where Civilization VII does not let a city work or build on them, so claimed land is territory, not extra yields. Its value is strategic: rivals cannot found a settlement on land you own.

[h2]What it does not do[/h2]

[list]
[*]No base-game files replaced.
[*]No AI rewrite, and culture gains land only for you. Nearby AI cities build pressure too, which defends their tiles and slows yours, but the AI takes land by culture only with recede on, and only tiles the mod claimed for you.
[*]Single-player only, with an off switch for vanilla border growth. Tiles already claimed stay yours when you switch it off: the game cannot hand a city's tile back to no one.
[*]It cannot be added to a game in progress: a save keeps the mods it started with, so begin a new game with Cultural Diffusion enabled.
[/list]

[h2]Roadmap — what's still coming[/h2]

This is an early release and actively developed. Core systems are tested in real games with a hands-free harness first. On the way:

[list]
[*][b]Tile ownership flip on conquest.[/b] An opt-in mode where plots your military units hold during a war flip to your territory immediately, independent of cultural pressure — land taken by force.
[*][b]Full Options-menu parity with Emigration.[/b] Grouped sub-headings, and a localized label and tooltip on every control.
[*][b]Continued balance tuning.[/b] Ongoing calibration of intensity presets, per-age pacing and the per-leader/civ/memento layer as more games are played.
[/list]

[h2]Credits[/h2]

[list]
[*]Tower, for design and Civilization VII implementation.
[*]Gedemon, creator of the Civilization V [i]Cultural Diffusion[/i] mod (v18) whose reaction-diffusion culture model — the inject / diffuse / decay / flip loop over a per-tile stock, plus its terrain and ownership rules — is the core layer this mod builds on.
[/list]

[h2]Special Thanks[/h2]

[list]
[*][b]Potato McWhisky[/b] — for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
