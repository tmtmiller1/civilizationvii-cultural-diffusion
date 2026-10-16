// cdh-lab-reparent.js: run 4's R8 SWAP for a turn-1 lab game (dev only). Installed with
//   node tower-bench.mjs eval "$(cat cdh-lab-reparent.js)"
// then driven one step per eval (each eval times out after 10 s):
//   cdr.found()          found the capital with the starting settler
//   cdr.site()           pick an unowned land plot 4 from the capital for the second settler (place it with the bench)
//   cdr.found()          found the second settlement
//   cdr.pick()           pick T: a bare tile of A (no district, not a centre) within 3 of B
//   cdr.rebuy()          B.purchasePlot(T), read inline and 4 s later
//   cdr.read("label")    read T again (after one turn, after five)
// The question: does B.purchasePlot move a tile already attached to A, another of our settlements, onto B?
(() => {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb === undefined ? "ERR:" + e : fb; } };
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = () => GameContext.localPlayerID;
  const dist = (a, b) => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y);
  const idx = (l) => GameplayMap.getIndexFromXY(l.x, l.y);
  const cities = () => safe(() => Players.get(me()).Cities.getCities() || [], []);
  const cid = (c) => safe(() => (typeof c.id === "number" ? c.id : c.id.id), -1);
  const cityById = (n) => cities().find((c) => cid(c) === n) || null;
  const nameOf = (c) => safe(() => Locale.compose(c.name), "?");
  const owningCity = (l) => safe(() => { const c = GameplayMap.getOwningCityFromXY(l.x, l.y); const id = c && c.id; return typeof id === "number" ? id : (id && id.id); }, "ERR");
  const mapCity = (l) => safe(() => { const c = MapCities.getCity(l.x, l.y); return c ? (typeof c.id === "number" ? c.id : c.id) : null; }, "ERR");
  const purchased = (c, l) => safe(() => (c.getPurchasedPlots() || []).includes(idx(l)), "ERR");
  const yields = (c) => safe(() => ({ food: c.Yields.getNetYield(YieldTypes.YIELD_FOOD), prod: c.Yields.getNetYield(YieldTypes.YIELD_PRODUCTION),
    gold: c.Yields.getNetYield(YieldTypes.YIELD_GOLD) }), "ERR");
  const worked = (c, l) => safe(() => { const w = c.Workers.getAllPlacementInfo(); const e = (w || []).find((p) => p.PlotIndex === idx(l));
    return e ? { workers: e.NumWorkers, cityPlot: e.CityID ? (e.CityID.id ?? e.CityID) : null } : null; }, "ERR");
  const S = (globalThis.cdr && globalThis.cdr.S) || { log: [] };
  function note(o) { S.log.push(o); return o; }

  async function found() {
    const before = cities().length;
    for (const id of safe(() => Players.get(me()).Units.getUnitIds(), []) || []) {
      const u = safe(() => Units.get(id), null);
      if (!u || !/SETTLER|FOUNDER/.test(String(safe(() => GameInfo.Units.lookup(u.type).UnitType, "")))) continue;
      const can = safe(() => Game.UnitOperations.canStart(id, UnitOperationTypes.FOUND_CITY, {}, false), "ERR");
      safe(() => Game.UnitOperations.sendRequest(id, UnitOperationTypes.FOUND_CITY, {}));
      for (let k = 0; k < 14 && cities().length === before; k++) await later(500);
      const cs = cities();
      if (cs.length > before) {
        const c = cs[cs.length - 1];
        if (!S.A) S.A = cid(c); else if (!S.B) S.B = cid(c);
        return note({ step: "found", ok: true, city: nameOf(c), id: cid(c), at: c.location, isTown: safe(() => c.isTown), can });
      }
      return note({ step: "found", ok: false, unitAt: { x: u.location.x, y: u.location.y }, can });
    }
    return note({ step: "found", ok: false, why: "no settler" });
  }

  function site() {
    const A = cityById(S.A);
    if (!A) return { ok: false, why: "no capital" };
    const out = [];
    for (const i of GameplayMap.getPlotIndicesInRadius(A.location.x, A.location.y, 4)) {
      const l = GameplayMap.getLocationFromIndex(i);
      if (dist(A.location, l) !== 4 || GameplayMap.isWater(l.x, l.y) || GameplayMap.isImpassable(l.x, l.y)) continue;
      if (GameplayMap.getOwner(l.x, l.y) !== -1 || GameplayMap.getResourceType(l.x, l.y) !== -1) continue;
      out.push({ x: l.x, y: l.y });
    }
    return note({ step: "site", capital: A.location, candidates: out.slice(0, 6) });
  }

  function pick() {
    const A = cityById(S.A); const B = cityById(S.B);
    if (!A || !B) return { ok: false, why: "need two settlements", A: S.A, B: S.B };
    const tiles = [];
    for (const i of GameplayMap.getPlotIndicesInRadius(A.location.x, A.location.y, 3)) {
      const l = GameplayMap.getLocationFromIndex(i);
      if (dist(A.location, l) < 1 || dist(B.location, l) > 3 || dist(B.location, l) < 1) continue;
      if (GameplayMap.getOwner(l.x, l.y) !== me() || owningCity(l) !== S.A) continue;
      if (GameplayMap.isWater(l.x, l.y)) continue;
      const district = safe(() => MapCities.getDistrict(l.x, l.y), null);
      tiles.push({ x: l.x, y: l.y, dA: dist(A.location, l), dB: dist(B.location, l), district: district ? "yes" : null });
    }
    const bare = tiles.filter((t) => !t.district).sort((p, q) => p.dB - q.dB);
    S.T = bare[0] ? { x: bare[0].x, y: bare[0].y } : null;
    return note({ step: "pick", A: { id: S.A, at: A.location, name: nameOf(A) }, B: { id: S.B, at: B.location, name: nameOf(B), isTown: safe(() => B.isTown) },
      candidates: tiles, T: S.T });
  }

  function read(label) {
    const A = cityById(S.A); const B = cityById(S.B); const T = S.T;
    if (!T) return { ok: false, why: "no T" };
    return note({ step: "read", label, turn: safe(() => Game.turn), T, owner: safe(() => GameplayMap.getOwner(T.x, T.y)), owningCity: owningCity(T),
      mapCity: mapCity(T), inA: purchased(A, T), inB: purchased(B, T), district: safe(() => MapCities.getDistrict(T.x, T.y), null),
      workedA: worked(A, T), workedB: worked(B, T), yieldsA: yields(A), yieldsB: yields(B), A: S.A, B: S.B });
  }

  async function rebuy() {
    const B = cityById(S.B); const T = S.T;
    if (!B || !T) return { ok: false, why: "need B and T" };
    const before = read("before");
    const call = safe(() => { B.purchasePlot(T); return "called"; }, "throw");
    const inline = read("inline");
    await later(4000);
    const after = read("after-4s");
    const verdict = after.owner === me() && after.owningCity === S.B
      ? (inline.owningCity === S.B ? "REPARENT-WORKS-INLINE" : "REPARENT-WORKS-DEFERRED") : "REPARENT-FAILS";
    return note({ step: "rebuy", call, verdict, before, inline, after });
  }

  globalThis.cdr = { S, found, site, pick, rebuy, read, log: () => S.log };
  return "cdr installed; S=" + JSON.stringify({ A: S.A, B: S.B, T: S.T });
})();
