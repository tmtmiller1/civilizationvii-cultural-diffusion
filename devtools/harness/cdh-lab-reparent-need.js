// cdh-lab-reparent-need.js: does a re-parent heal have anything to heal? (dev only). Installed with
//   node tower-bench.mjs eval "$(cat cdh-lab-reparent-need.js)"
// Check 2, in a turn-1 lab game (after cdh-lab-reparent.js founded the capital):
//   need.far()            pick T4 (unowned land at distance 4 from the capital) and a town site within 2 of T4
//   need.buyFar()         the capital buys T4; read where it landed 4 s later
//   (found the town with the bench and cdr.found())
//   need.expand()         the town's EXPAND list, canStart on T4, then a direct EXPAND onto T4; read T4 4 s later
// Check 1, in a loaded save:
//   need.scan()           every major player's tiles attached to a settlement more than 3 away while another of
//                         that player's settlements is within 3; read only
(() => {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb === undefined ? "ERR:" + e : fb; } };
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y);
  const cityKey = (c) => safe(() => c.id.id, -1);
  const N = (globalThis.need && globalThis.need.N) || {};
  const mine = () => safe(() => Players.get(GameContext.localPlayerID).Cities.getCities() || [], []);
  const at = (l) => ({ owner: safe(() => GameplayMap.getOwner(l.x, l.y)), city: safe(() => { const c = MapCities.getCity(l.x, l.y); return c ? c.id : null; }, null),
    district: safe(() => { const d = MapCities.getDistrict(l.x, l.y); return d ? d.id : null; }, null) });

  function far() {
    const cap = mine()[0];
    if (!cap) return { ok: false, why: "no capital" };
    const land = (l) => !GameplayMap.isWater(l.x, l.y) && !GameplayMap.isImpassable(l.x, l.y) && GameplayMap.getOwner(l.x, l.y) === -1;
    for (const i of GameplayMap.getPlotIndicesInRadius(cap.location.x, cap.location.y, 4)) {
      const t = GameplayMap.getLocationFromIndex(i);
      if (dist(cap.location, t) !== 4 || !land(t)) continue;
      for (const j of GameplayMap.getPlotIndicesInRadius(t.x, t.y, 2)) {
        const s = GameplayMap.getLocationFromIndex(j);
        const ds = dist(t, s);
        if (ds < 1 || dist(cap.location, s) < 6 || !land(s) || GameplayMap.getResourceType(s.x, s.y) !== -1) continue;
        N.T4 = { x: t.x, y: t.y }; N.site = { x: s.x, y: s.y };
        return { ok: true, capital: cap.location, T4: N.T4, site: N.site, dT4site: ds, dCapSite: dist(cap.location, s) };
      }
    }
    return { ok: false, why: "no T4 with a site" };
  }

  async function buyFar() {
    const cap = mine()[0];
    const before = at(N.T4);
    const call = safe(() => { cap.purchasePlot(N.T4); return "called"; }, "throw");
    await later(4000);
    return { call, before, after: at(N.T4), capital: cityKey(cap), inCapital: safe(() => cap.getPurchasedPlots().includes(GameplayMap.getIndexFromXY(N.T4.x, N.T4.y))) };
  }

  async function expand() {
    const cs = mine();
    const town = cs.find((c) => c.location.x === N.site.x && c.location.y === N.site.y);
    if (!town) return { ok: false, why: "no town at site" };
    const idx = GameplayMap.getIndexFromXY(N.T4.x, N.T4.y);
    const list = safe(() => Game.CityCommands.canStart(town.id, CityCommandTypes.EXPAND, {}, false), null);
    const plots = list && (list.Plots || list.plots) || [];
    const listed = Array.isArray(plots) ? plots.includes(idx) : "unreadable";
    const canT4 = safe(() => Game.CityCommands.canStart(town.id, CityCommandTypes.EXPAND, { X: N.T4.x, Y: N.T4.y }, false), null);
    const pending = safe(() => town.Growth.isReadyToPlacePopulation, "?");
    const before = at(N.T4);
    const send = safe(() => Game.CityCommands.sendRequest(town.id, CityCommandTypes.EXPAND, { X: N.T4.x, Y: N.T4.y }), "ERR");
    await later(4000);
    return { town: cityKey(town), dTownT4: dist(town.location, N.T4), pending, listCount: Array.isArray(plots) ? plots.length : null, listed,
      listSuccess: list && list.Success, canT4, send, before, after: at(N.T4) };
  }

  function scan() {
    const out = []; let tiles = 0; let settlements = 0;
    for (const p of safe(() => Players.getAlive(), []) || []) {
      if (!p.isMajor) continue;
      const cs = safe(() => p.Cities.getCities() || [], []);
      settlements += cs.length;
      for (const c of cs) {
        for (const i of safe(() => c.getPurchasedPlots() || [], [])) {
          tiles++;
          const l = GameplayMap.getLocationFromIndex(i);
          const d = dist(c.location, l);
          if (d <= 3) continue;
          const near = cs.filter((o) => o !== c && dist(o.location, l) <= 3).map((o) => ({ id: cityKey(o), d: dist(o.location, l), town: safe(() => o.isTown) }));
          const district = safe(() => MapCities.getDistrict(l.x, l.y), null);
          out.push({ player: p.id, x: l.x, y: l.y, city: cityKey(c), d, nearer: near, district: district ? "yes" : null });
        }
      }
    }
    const stuck = out.filter((r) => r.nearer.length);
    return { turn: safe(() => Game.turn), settlements, tiles, beyond3: out.length, beyond3Improved: out.filter((r) => r.district).length,
      stuck: stuck.length, stuckImproved: stuck.filter((r) => r.district).length, stuckList: stuck.slice(0, 40) };
  }

  globalThis.need = { N, far, buyFar, expand, scan };
  return "need installed";
})();
