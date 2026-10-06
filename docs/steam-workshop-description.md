[h1]Cultural Diffusion[/h1]
For Civilization VII 1.5.0.
Cultural Diffusion lets culture move your borders. Every turn, your cities put culture onto the tiles around them. It spreads outward one tile at a time, faster along roads and rivers and slower through rough terrain. When your culture is the strongest on a tile, that tile becomes yours, including tiles past the three rings a city normally reaches. It's slow, it follows the shape of the map, and it gives you a way to push back when the AI settles four tiles from your capital.
Based on Gedemon's [b]Cultural Diffusion[/b] mod for Civ V, rebuilt for Civ VII.
[h2]Mechanics[/h2]
[list]
[*][b]Works with game version 1.5.0.[/b]
[*][b]Culture spreads tile by tile.[/b] Each city adds culture to its own tile every turn. It spreads to the tiles next to it, and fades a little everywhere. Your save keeps track of how much culture each civ has on each tile, so borders move forward gradually instead of jumping out in rings.
[*][b]Terrain matters.[/b] Culture moves easily along roads and rivers, slowly through hills, tundra, desert, forest, jungle and marsh, and barely crosses mountains.
[*][b]Helps against forward settling.[/b] Land around your cities fills in over time. If your culture is clearly stronger on a rival's border tile, it can become yours without a war.
[*][b]More than Culture per turn.[/b] Prosperous cities spread more culture, and so does a civ with wonders, great works, Influence, suzerainties, happiness, golden ages and traditions. It also gets stronger later in the age and while you're celebrating.
[*][b]Cities can hold more than one culture.[/b] A captured city, or one with people from other civs, keeps their culture for a while and keeps spreading it until yours slowly takes over. When a city is captured, the conqueror takes over the culture on its tiles.
[*][b]Rivers count.[/b] Culture travels along a river but has a harder time crossing one.
[*][b]Balanced per leader and civ.[/b] Leaders and civs that already get extra territory are toned down, and ones with little Culture get a boost, so the same strategy doesn't win every game.
[*][b]Fair to neighbors.[/b] Culture never takes the last tile another civ's unit could move to, and city-states and independents always keep the ring around their settlement.
[*][b]Paced per age.[/b] Speed is adjusted for each age and map size, so it works on fast games and small maps.
[*][b]Explained in the Civilopedia.[/b] Every rule has its own page.
[*][b]Readable source code.[/b] Nothing is minified.
[/list]
[h2]The Cultural Pressure lens[/h2]
Press Shift+C to see which tiles are about to change hands. The closer a tile is to flipping, the stronger its color. Hover over a tile to see each civ's culture there and roughly how many turns until it flips. Tiles that won't change aren't colored. You can turn the lens off in Options.
[h2]How a tile changes hands[/h2]
[list]
[*]Your culture is the highest on the tile and above a minimum amount.
[*]To take a tile from another civ, you need clearly more culture than they have. A tie isn't enough.
[*]The tile has to touch land you already own, so your borders stay connected.
[*]A rival's city center can never be taken, and you can choose to protect the ring around it too.
[*]A newly claimed tile is locked for a few turns so it can't flip back and forth.
[*]Improved tiles change hands whole: a farm or mine that flips is rebuilt for its new owner. Urban districts, city centers and wonders never move by culture, and every tile holds still during the Age Ending countdown and the first two turns of the next age.
[/list]
[h2]When you'll see it[/h2]
Not right away. In a 70-turn test game, a capital making 8 Culture didn't claim anything. Once your cities have grown, a strong city takes its first tile past ring 3 about twenty turns after the mod starts having an effect. Going further out takes a civ with wonders and a long history. This mostly matters in the mid and late game. Raise the intensity if you want it sooner.
[h2]Settings[/h2]
Intensity: [b]Low[/b] only claims empty land, [b]Medium[/b] (the default) can also take rival border tiles, and [b]High[/b] spreads farther and flips faster. There are also switches for turning the mod on or off, claiming empty land only, how much of a rival's city ring is protected, keeping borders connected, claiming land next to new improvements, letting your borders shrink when a rival out-cultures you (experimental), letting other civs gain land by culture (on by default), letting armies take tiles they hold during a war (never city centers or urban districts), cities holding the culture of everyone living in them, the lens, and debug logging. Every number behind these can be changed in the mod's config.
[h2]Works with Emigration[/h2]
[list]
[*]If you also use the [url=https://steamcommunity.com/sharedfiles/filedetails/?id=3750554030]Emigration[/url] mod, culture spreads faster toward tiles where your people have moved, so your borders grow toward them. Without Emigration installed, this part does nothing.
[/list]
[h2]Two limits of the game engine[/h2]
[list]
[*][b]Tiles past a city's third ring can't be worked.[/b] The game won't let a city work or build there, so these tiles give you territory, not yields. They still matter: nobody can settle on land you own.
[*][b]Mods can't move other civs' units.[/b] So the mod never takes the last tile a unit could escape to. It waits until the unit moves.
[/list]
[h2]Languages[/h2]
English, German, Spanish, French, Italian, Japanese, Korean, Polish, Brazilian Portuguese, Russian, and Simplified and Traditional Chinese. Machine translated, so corrections are welcome.
[h2]Caveats and known issues[/h2]
[list]
[*][b]Single player only.[/b] No base game files are replaced.
[*][b]Start a new game with the mod on.[/b] A save keeps the mod list it started with, so you can't add Cultural Diffusion to a game in progress.
[*][b]Claimed tiles stay yours.[/b] If you turn the mod off, it stops claiming new tiles, but the tiles it already gave you stay yours. The game has no way to make a city's tile unowned again.
[*][b]AI civs gain land by culture too.[/b] A civ whose culture clearly wins a tile near you can take it, including one of yours, and you get a notification when that happens. City-states never do. Turn off "Every civilization gains land by culture" in Options if you only want this for yourself.
[*][b]Nothing happens early.[/b] Borders don't move in the first fifty turns. That's expected.
[/list]
[h2]Still coming[/h2]
[list]
[*][b]A better Options screen,[/b] laid out like Emigration's, with section headings and a label and tooltip on every setting.
[*][b]More balancing[/b] of the intensity levels, age pacing and leader tuning as more games get played.
[/list]
[h2]Source and documentation[/h2]
[list]
[*][b]What's new:[/b] [url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/releases/latest]latest release notes and download[/url]
[*][b]Full documentation:[/b] [url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/blob/main/README.md]how the mod works[/url]
[*][b]PDF version:[/b] [url=https://github.com/tmtmiller1/civilizationvii-cultural-diffusion/blob/main/README.pdf]README.pdf, with screenshots[/url]
[/list]
[h2]For modders[/h2]
I test this mod with [url=https://github.com/tmtmiller1/civilizationvii_tower-bench]Tower Bench[/url], a free, open-source tool for building and testing Civilization VII mods.
[h2]Credits[/h2]
[list]
[*][b]Tower:[/b] design and Civilization VII version.
[*][b]Gedemon:[/b] made the original Civilization V [i]Cultural Diffusion[/i] mod (v18). Its culture model, where culture is added, spreads, fades and flips tiles, with rules for terrain and ownership, is the foundation this mod is built on.
[/list]
[h2]Special Thanks[/h2]
[list]
[*][b]Potato McWhisky[/b], for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
