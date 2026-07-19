[h1]Cultural Diffusion[/h1]

[i]Cultural Diffusion[/i] turns your civilization's [b]cultural pressure[/b] into a living field that spreads from your cities tile by tile. A strong, established civilization slowly grows its borders past the normal city footprint, seeps into open land, and can flip a rival's frontier tiles once its cultural pressure there decisively wins — a systemic answer to AI forward-settling. Growth is slow and organic: borders creep outward over the game and flow back when a civilization's pressure weakens, and an overwhelming one reaches farther.

[i]A quick note on terms: "cultural pressure" is this mod's own quantity — a per-tile stock your cities build up over the game. It is [b]not[/b] the base game's Culture yield. The Culture yield is one of several inputs that feed cultural pressure, alongside a city's prosperity and your civilization's Cultural Power Index.[/i]

A reimagining and extension of Gedemon's [b]Cultural Diffusion[/b] mod for Civilization V, rebuilt for Civ VII with a deeper cultural-power model and optional [b]Emigration[/b] integration. It runs in single-player only, is fully tunable, and can be switched off at any time. It works fully standalone, and reads diaspora data from the [b]Emigration[/b] mod when that is also installed.

Like its companion [b]Emigration[/b], this mod is a work in progress. Balance is still being tuned, more is planned (see the roadmap below), and nearly every system can be adjusted through the Options panel. Feedback on how borders feel at each intensity is very welcome.

[b]How it works — a pressure field, not a border calculation[/b]

Every frontier tile remembers how much cultural pressure each civilization has deposited on it. Once per turn, over a bounded region around your cities, four things happen: cities [b]inject[/b] pressure into their own tile using a self-amplifying curve; that pressure [b]diffuses[/b] outward to neighboring tiles, following roads and river valleys and slowed or blocked by hills, mountains, and rough terrain; every tile slowly [b]decays[/b], the constant brake that keeps growth stable and lets a border flow back when a city weakens; and ownership is read off the stock — a tile [b]flips[/b] to you once your pressure there is largest, clears an absolute floor, and (when taking it from a rival) beats theirs by a decisive ratio, while staying contiguous with land you already own. A rival's downtown ring is never taken.

Because pressure must physically build up ring by ring against decay, reach is an emergent travelling wave, not a distance formula. Ring 3 is a mid-game event; ring 5+ belongs only to a mature, entrenched civilization.

[b]What Cultural Diffusion does[/b]

[list]
[*]Cities pump cultural pressure into a persisted per-tile stock (a reaction-diffusion field) that diffuses to neighbours and decays each turn, so borders grow as a slow, organic travelling wave rather than snapping to a radius.
[*]Terrain shapes the spread: cultural pressure follows roads and river valleys and is slowed or blocked crossing hills, mountains, tundra and desert biomes, and forest, jungle, and marsh features.
[*]It answers AI forward-settling. A confident civilization claims the buffer around your cities and can reclaim a rival's frontier tiles where your cultural pressure clearly wins there, so growing your border is the deterrent.
[*]Reach comes from cultural power, not raw Culture yield. A city's injection strength is a geometric blend of its Culture yield with a prosperity/vitality aggregate, a per-civilization Cultural Power Index (wonders, great works, Culture, Influence, city-state suzerainties, happiness, golden ages, traditions, age), and a celebration bonus, so a happy, prosperous, entrenched city reaches farther while a lone +Culture or +happiness spike is diluted rather than a runaway multiplier.
[*]With Emigration installed, optional ethnic-affinity diffusion reads its diaspora data so your cultural pressure flows toward tiles your people settled; it is simply neutral when Emigration is absent, so the mod stays standalone-safe.
[*]Per-age tuning for the three ages plus game-settings calibration re-times the field to the current age length and nudges injection by map size, so the border arc stays consistent across game speeds and cramped maps aren't steamrolled.
[*]A per-leader, civilization, and memento tuning table damps territory-redundant kits (e.g. Culture-on-capture) and gently lifts Culture-poor civs, so no single kit snowballs.
[/list]

[i]Full formulas, tunables, and per-leader tuning are documented in the README.[/i]

[b]Tuning[/b]

One intensity knob: [b]Low[/b] (a gentle nudge into empty land only), [b]Medium[/b] (default; contests rival frontier tiles), and [b]High[/b] (assertive; spreads farther and flips faster), plus toggles for the master enable, a claim-empty-land-only safety mode, free-territory vs. buy-with-gold claiming, the rich cultural-power model, follow-diaspora, and debug logging. Every underlying field, terrain, injection, calibration, and per-age value is overridable.

[b]It changes real tile ownership[/b]

Tile ownership physically changes through real gameplay writes each turn. Yields are earned through normal population and building growth on the land your cultural pressure claims — this is not a UI overlay.

[b]What it does not do[/b]

[list]
[*]No base-game files replaced.
[*]No AI rewrite.
[*]Single-player, flag-gated, and reversible — turn it off for vanilla borders.
[/list]

[b]Roadmap — what's still coming[/b]

This is an early release and actively developed. Nothing lands until it has passed its own in-game verification pass, the way the core diffusion loop did. On the way:

[list]
[*][b]Tile ownership flip on conquest.[/b] An opt-in mode where plots your military units occupy during a war flip to your territory immediately, independent of cultural pressure — modelling land taken by force, resolved after diffusion and migration have settled for the turn.
[*][b]Full Options-menu parity with Emigration.[/b] Grouped sub-headings, one persisted setting per toggle, and a localized label and tooltip on every control, so the panel reads as a coherent whole.
[*][b]Continued balance tuning.[/b] Ongoing calibration of intensity presets, per-age pacing, and the per-leader/civ/memento layer as more games are played.
[/list]

[i]The full backlog lives in the repository's roadmap doc.[/i]

[b]Credits[/b]

[list]
[*]Tower, for design and Civilization VII implementation.
[*]Gedemon, creator of the Civilization V [i]Cultural Diffusion[/i] mod (v18) whose reaction-diffusion culture model — the inject / diffuse / decay / flip loop over a per-tile stock, plus its terrain and ownership rules — is the core layer this mod builds on.
[/list]

[h2]Special Thanks[/h2]

[list]
[*][b]Potato McWhisky[/b] — for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
