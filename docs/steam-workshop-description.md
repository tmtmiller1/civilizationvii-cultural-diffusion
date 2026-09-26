[h1]Cultural Diffusion[/h1]
[b]New in 1.4.0: a Civilopedia section, and rivals that expand by culture[/b]
Every rule now has a page in the in-game Civilopedia, under its own Cultural Diffusion tab, and each Options tooltip names the page that explains it. Other civilizations now gain land by culture by default, under the same rules as you. 1.3.0 brought in the rest of Gedemon's model: cities carry every culture living in them, culture passes to a city's conqueror, rivers carry culture along them and hold it back across them, and an opt-in mode lets armies take the ground they hold in a war. For Civilization VII 1.5.0.
Cultural Diffusion grows your borders out of culture instead of a radius. Your cities deposit culture on the ground around them every turn; it seeps outward along roads and river valleys, drags through rough terrain, and land where your culture wins becomes yours, including land past the three rings a city can normally claim. It is slow, it follows the map, and it answers an AI settling four tiles from your capital. A reimagining and extension of Gedemon's [b]Cultural Diffusion[/b] (Civ V), rebuilt for Civ VII with a deeper model of what makes a city's culture carry, and pairing with the [b]Emigration[/b] companion mod.
[h2]Mechanics[/h2]
[list]
[*][b]Compatible with 1.5.0.[/b]
[*][b]A culture field, not a radius.[/b] Each city deposits culture on its own tile every turn, it seeps one tile outward at a time, and every tile sheds a little. The stock is kept per tile and per civilization in your save, so borders creep as a front, not a circle.
[*][b]Terrain decides the shape.[/b] Culture follows roads and rivers, drags through hills, tundra, desert, forest, jungle and marsh, and mostly gives up at mountains.
[*][b]An answer to forward-settling.[/b] The buffer around your cities fills in, and a rival's frontier tile can change hands where your culture clearly wins, without anyone declaring war.
[*][b]Reach is more than Culture yield.[/b] A city pushes harder when it is prosperous, and when your civilization has weight behind it: wonders, great works, Influence, suzerainties, happiness, golden ages, traditions and how late the age is, plus a lift while you celebrate.
[*][b]Tuned per leader and civilization.[/b] Leader, civilization and memento tuning damps kits that already hand you territory and lifts Culture-poor ones, so one strategy does not take the map every game.
[*][b]Room for your neighbours.[/b] A claim never takes the last tile another civilization's unit could move to, and minor settlements keep a protected ring.
[*][b]Per-age pacing.[/b] Per-age tuning and map-size calibration re-time the field to the length of the age, so it holds up on a fast game and a cramped map.
[*][b]Readable, un-minified source.[/b]
[/list]
[h2]The Cultural Pressure lens[/h2]
Shift+C shades the tiles on their way to changing hands, stronger the closer they are, with a hover readout of each civilization's culture there and a rough count of turns until it flips. Tiles where nothing will happen stay unshaded: the lens shows what the mod will do, not what merely looks contested. It can be switched off in Options.
[h2]How a tile changes hands[/h2]
[list]
[*]Your culture on it is the largest there, and past a floor worth counting.
[*]Taking one off another civilization needs a clear margin, not a tie.
[*]It touches land you already hold, so your border stays in one piece.
[*]A rival's city centre is never taken, and the ring around it can be shielded too.
[*]A fresh claim is locked briefly, so borders cannot flicker.
[/list]
[h2]When you will see it[/h2]
Not early. In a 70-turn test game, a capital making 8 Culture claimed nothing at all. Once cities have grown, a strong one took its first tile past ring 3 about twenty turns after the mod started working; the rings beyond belong to a civilization with wonders and history behind it. This is a mid and late game system, and intensity is the knob if you want it sooner.
[h2]Settings[/h2]
One intensity knob: [b]Low[/b] nudges into empty land only, [b]Medium[/b] is the default and contests rival frontier tiles, [b]High[/b] spreads farther and flips faster. Separate switches cover the master enable, an empty-land-only mode, how much of a rival's city ring is protected, contiguous borders, claiming land beside new improvements, borders receding to a rival who out-cultures you (experimental), other civilizations gaining land by culture (on by default), armies taking the ground they hold in a war, cities carrying every culture living in them, the lens, and debug logging. Every value underneath can be overridden.
[h2]Pairs with Emigration[/h2]
[list]
[*]With the [b]Emigration[/b] companion mod installed, culture follows your people: it flows faster toward tiles your diaspora settled, so borders grow toward where your population went. The hooks stay inert when it is not installed, so the base mod is unchanged.
[/list]
[h2]Two limits of the game engine[/h2]
[list]
[*][b]Land past a city's third ring cannot be worked.[/b] Civilization VII will not let a city work or build out there, so claimed ground is territory rather than yields. Its worth is positional: nobody can plant a settlement on land you own.
[*][b]A mod cannot move another civilization's unit.[/b] No unit operation moves a unit you do not own, and the engine's teleport is missing from the version mods can reach. So expansion does not shove anyone aside: it leaves a way out and takes the tile once the unit has gone.
[/list]
[h2]Languages[/h2]
English only for now. Ask for a language and I will add it.
[h2]Caveats and known issues[/h2]
[list]
[*][b]Single player only,[/b] and no base-game files are replaced.
[*][b]Start a new game with it enabled.[/b] A save keeps the mod list it began with, so Cultural Diffusion cannot join a game already in progress.
[*][b]Claimed tiles stay claimed.[/b] Switch the mod off and new claims stop, but ground it took stays yours: the game cannot hand a city's tile back to nobody.
[*][b]Rivals gain land by culture too.[/b] A civilization whose culture decisively wins a tile near your lands can take it, including one of yours, and you are told when it does. City-states never do. Switch off Every civilization gains land by culture in Options to keep culture expansion yours alone.
[*][b]Nothing happens early.[/b] Watch for moving borders in your first fifty turns and you will see none. That is the model, not a fault.
[/list]
[h2]Still coming[/h2]
[list]
[*][b]Options panel parity with Emigration.[/b] Grouped headings, and a label and tooltip on every control.
[*][b]More balance work.[/b] Intensity presets, per-age pacing and per-leader tuning, as more games get played.
[/list]
[h2]Source and documentation[/h2]
[list]
[*][url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion]Open source on GitHub[/url]
[*][url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/releases/latest]The latest release notes and a download[/url]
[*][url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/blob/main/README.md]Full documentation, with every formula and tuning knob[/url]
[*][url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/blob/main/README.pdf]The same document as a typeset PDF[/url]
[/list]
[h2]Credits[/h2]
[list]
[*][b]Tower[/b], for design and Civilization VII implementation.
[*][b]Gedemon[/b], creator of the Civilization V [i]Cultural Diffusion[/i] mod (v18), whose reaction-diffusion culture model — the inject / diffuse / decay / flip loop over a per-tile stock, plus its terrain and ownership rules — is the core layer this mod builds on.
[/list]
[h2]Special Thanks[/h2]
[list]
[*][b]Potato McWhisky[/b], for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
