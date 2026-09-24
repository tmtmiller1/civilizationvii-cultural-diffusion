[h1]Cultural Diffusion[/h1]
[b]New in 1.2.0: borders that leave room for other people[/b]
A claim now leaves another civilization's unit a legal move, so nothing you are at peace with ends up sealed inside your territory; the tile is taken later, once the unit has moved on, and ships and embarked units count too. City-states and villages keep a protected ring around their settlement, so cultural pressure cannot reduce a minor to the single tile its town sits on. Both came from a player's report, were reproduced in a test game before anything changed, and were watched working in one afterwards. For Civilization VII 1.5.0.
[b]The Cultural Pressure lens[/b]
Shift+C shades the tiles that are on their way to changing hands, stronger the closer they are, with a hover readout of every civilization's culture on that tile and a rough count of turns until it flips. Tiles where nothing is going to happen stay unshaded: the lens shows what the mod will do, not what merely looks contested.
Cultural Diffusion grows your borders out of culture instead of a radius. Your cities deposit culture on the ground around them every turn; it seeps outward along roads and river valleys, drags through rough terrain, and land where your culture wins becomes yours, including land past the three rings a city can normally claim. It is slow, it follows the map, and it gives you an answer to an AI settling four tiles from your capital. A reimagining and extension of Gedemon's [b]Cultural Diffusion[/b] (Civ V), rebuilt for Civ VII with a deeper model of what makes a city's culture carry, and pairing with the [b]Emigration[/b] companion mod when that is installed.
[h2]The Mod Includes[/h2]
[list]
[*]A per-tile, per-civilization culture stock, persisted in your save, that cities feed every turn and every tile sheds a little of, so borders creep outward as a front rather than snapping to a circle.
[*]Terrain that matters: culture follows roads and river valleys, drags through hills, tundra, desert, forest, jungle and marsh, and mostly gives up at mountains.
[*]An answer to AI forward-settling: the buffer around your cities fills in, and a rival's frontier tile can change hands without anyone declaring war.
[*]Reach that comes from more than Culture yield. A city pushes harder when it is prosperous, and when your civilization has weight behind it: wonders, great works, Influence, city-states under your suzerainty, happiness, golden ages, traditions and how late the age is, plus a lift while you are celebrating.
[*]Per-leader, civilization and memento tuning that damps kits already handing you territory and lifts Culture-poor ones, so the same strategy does not win the map every game.
[*]Per-age pacing and map-size calibration, so the border arc holds up on a fast game and a cramped map.
[*]Readable, un-minified source.
[/list]
[h2]How a Tile Changes Hands[/h2]
[list]
[*]Your culture on it is the largest there, and has passed a floor worth counting.
[*]Taking one off another civilization needs a clear margin, not a tie.
[*]It touches land you already hold, so your border stays in one piece.
[*]A rival's city centre is never taken, and the ring around it can be shielded as well.
[*]A fresh claim is locked briefly, so borders cannot flicker back and forth.
[/list]
[h2]When You Will See It[/h2]
Not early. In a 70-turn test game, a capital making 8 Culture claimed nothing at all. Once cities have grown, a strong one took its first tile past ring 3 about twenty turns after the mod started working, and the rings beyond that belong to a civilization with wonders and history behind it. This is a mid and late game system; intensity is the knob if you want borders moving sooner.
[h2]What Claimed Land Is[/h2]
Real ownership, changed through the game's own writes each turn, not a colour laid over the map. It is ground rather than yields: Civilization VII does not let a city work or build past its third ring, so the value is positional. Nobody can plant a settlement on land you own.
[h2]Settings[/h2]
One intensity knob: [b]Low[/b] nudges into empty land only, [b]Medium[/b] is the default and contests rival frontier tiles, [b]High[/b] spreads farther and flips faster. Separate switches cover the master enable, an empty-land-only mode, how much of a rival's city ring is protected, contiguous borders, claiming land beside newly finished improvements, borders receding to a rival whose culture overtakes yours (experimental), the lens, and debug logging. Every terrain penalty, injection, decay, calibration and per-age value underneath can be overridden.
[h2]Pairs with Emigration[/h2]
[list]
[*]With the [b]Emigration[/b] companion mod installed, culture follows your people: it flows faster toward tiles your diaspora settled, so borders grow toward where your population actually went. The hooks stay inert when it is not installed, so the base mod is unchanged.
[/list]
[h2]Notes[/h2]
Single-player, and no base-game files are replaced. Culture gains land for you, not for the AI: nearby AI cities build culture too, which defends their tiles and slows yours down, but they take ground this way only with receding borders switched on. Start a new game with it enabled, since a save keeps the mod list it began with. Switch it off mid-game and new claims stop, though tiles it already took stay yours, because the game cannot hand a city's tile back to nobody.
[h2]Still Coming[/h2]
[list]
[*][b]Tile ownership flip on conquest:[/b] an opt-in mode where ground your army holds during a war becomes yours outright, culture or no culture.
[*][b]Options panel parity with Emigration:[/b] grouped headings, and a label and tooltip on every control.
[*][b]More balance work:[/b] intensity presets, per-age pacing and the per-leader tuning, as more games get played.
[/list]
[h2]Source and documentation[/h2]
[list]
[*][b]What's new:[/b] [url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/releases/latest]the latest release notes and a download[/url]
[*][b]Full documentation:[/b] [url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/blob/main/README.md]every formula and tunable, and how each is calculated[/url]
[*][b]The same as a PDF:[/b] [url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/blob/main/README.pdf]README.pdf, typeset with the screenshots[/url]
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
