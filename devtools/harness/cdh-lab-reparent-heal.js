// cdh-lab-reparent-heal.js: watch the re-parent heal (cd-reparent.js) in a turn-1 lab game (dev only). Installed with
//   node tower-bench.mjs eval "$(cat cdh-lab-reparent-heal.js)"
// after cdh-lab-reparent.js has founded the capital (cdr.found()). Steps, one per eval:
//   heal.site(owner)     a town site 5 from that player's capital (default: yours), with two of the capital's ring-1
//                        tiles 4+ from it; returns the state under a key per owner, so you and an AI can both be set up
//   (yours: place a Settler there with the bench, then cdr.found(); an AI's: tower-bench place town x y --owner N)
//   heal.damage()        the town buys both tiles (the 1.0.6 shape: on a settlement more than 3 away), and the second
//                        gets a rural district and a Farm for the town; read 4 s later
//   heal.pass()          culturalDiffusion.runNow(), then read both tiles every second for 8 s
//   heal.read("label")   read both tiles again (after a turn)
(() => {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb === undefined ? "ERR:" + e : fb; } };
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y);
  const H = (globalThis.heal && globalThis.heal.H) || { log: [], by: {} };
  const citiesOf = (o) => safe(() => Players.get(Number(o)).Cities.getCities() || [], []);
  const byId = (o, n) => citiesOf(o).find((c) => c.id.id === n) || null;
  const land = (l) => !GameplayMap.isWater(l.x, l.y) && !GameplayMap.isImpassable(l.x, l.y);
  const idx = (l) => GameplayMap.getIndexFromXY(l.x, l.y);
  function at(o, l) {
    const P = H.by[o]; const cap = byId(o, P.cap); const town = byId(o, P.town);
    const c = safe(() => MapCities.getCity(l.x, l.y), null);
    const d = safe(() => MapCities.getDistrict(l.x, l.y), null);
    return { x: l.x, y: l.y, owner: safe(() => GameplayMap.getOwner(l.x, l.y)), city: c ? c.id : null, district: d ? d.id : null,
      resolves: d ? !!safe(() => Districts.get(d), null) : null, cons: safe(() => (MapConstructibles.getConstructibles(l.x, l.y) || []).length, 0),
      inCap: cap ? safe(() => cap.getPurchasedPlots().includes(idx(l))) : null, inTown: town ? safe(() => town.getPurchasedPlots().includes(idx(l))) : null };
  }
  function read(label) {
    const o = { label, turn: safe(() => Game.turn) };
    for (const k of Object.keys(H.by)) { const P = H.by[k]; o[k] = { bare: P.bare ? at(k, P.bare) : null, farm: P.farm ? at(k, P.farm) : null }; }
    H.log.push(o); return o;
  }

  function site(owner = GameContext.localPlayerID) {
    const cap = citiesOf(owner)[0];
    if (!cap) return { ok: false, why: "no capital for " + owner };
    const P = H.by[owner] = { cap: cap.id.id };
    for (const i of GameplayMap.getPlotIndicesInRadius(cap.location.x, cap.location.y, 5)) {
      const s = GameplayMap.getLocationFromIndex(i);
      if (dist(cap.location, s) !== 5 || !land(s) || GameplayMap.getOwner(s.x, s.y) !== -1 || GameplayMap.getResourceType(s.x, s.y) !== -1) continue;
      const ring1 = GameplayMap.getPlotIndicesInRadius(cap.location.x, cap.location.y, 1).map((j) => GameplayMap.getLocationFromIndex(j))
        .filter((l) => dist(cap.location, l) === 1 && land(l) && GameplayMap.getOwner(l.x, l.y) === owner
          && !safe(() => MapCities.getDistrict(l.x, l.y), null) && dist(s, l) >= 4);
      if (ring1.length < 2) continue;
      P.site = { x: s.x, y: s.y }; P.bare = { x: ring1[0].x, y: ring1[0].y }; P.farm = { x: ring1[1].x, y: ring1[1].y };
      return { owner, site: P.site, bare: P.bare, farm: P.farm, dTownBare: dist(s, P.bare), dTownFarm: dist(s, P.farm) };
    }
    return { ok: false, why: "no site" };
  }

  async function damage(owner = GameContext.localPlayerID) {
    const P = H.by[owner];
    const town = citiesOf(owner).find((c) => c.location.x === P.site.x && c.location.y === P.site.y);
    if (!town) return { ok: false, why: "no town for " + owner };
    P.town = town.id.id;
    town.purchasePlot(P.bare); town.purchasePlot(P.farm);
    await later(4000);
    const farm = GameInfo.Constructibles.lookup("IMPROVEMENT_FARM").$index;
    const ops = Game.PlayerOperations; const me = GameContext.localPlayerID;
    ops.sendRequest(me, "CREATE_ELEMENT", { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: P.farm, Parent: town.id, Owner: owner });
    ops.sendRequest(me, "CREATE_ELEMENT", { Kind: "CONSTRUCTIBLE", Type: farm, Location: P.farm, Parent: town.id, Owner: owner });
    await later(4000);
    return read("damaged-" + owner);
  }

  async function pass() {
    const r = safe(() => globalThis.culturalDiffusion.runNow(), "ERR");
    const reads = [];
    for (let k = 0; k < 8; k++) { await later(1000); reads.push(read("pass+" + (k + 1) + "s")); }
    const firstHome = (k, which) => reads.findIndex((o) => o[k][which].city === H.by[k].cap) + 1;
    const moved = {};
    for (const k of Object.keys(H.by)) moved[k] = { bareAt: firstHome(k, "bare"), farmAt: firstHome(k, "farm") };
    return { pass: r, last: reads[reads.length - 1], movedAfterSeconds: moved };
  }

  globalThis.heal = { H, site, damage, pass, read, log: () => H.log };
  return "heal installed";
})();
