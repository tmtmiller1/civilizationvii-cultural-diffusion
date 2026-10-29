// cdh-lab-blob.js: watch borders grow as a solid shape (cd-eligibility.js leftToBaseGame / leavesGapBehind) in a
// turn-1 lab game (dev only). Installed with
//   node tower-bench.mjs eval "$(cat cdh-lab-blob.js)"
// Steps, one per eval:
//   blob.init()          found the capital; pick the rival town site (4 from it, east), the mountain and marsh sites
//                        (ring 3, east, away from the rival), and our second town site (5 west); returns the plan
//   (the runner places the rival town, the mountain, the marsh with the bench)
//   blob.pass(label)     seed our culture (strong east, weak west, at the capital and its ring 1), runNow(), read
//   blob.read(label)     ownership, new claims in order, gaps behind our and the AI's claims, the lens and the hover
//                        readout on tiles waiting on the land behind them, shared tiles, the city each tile joined
//   blob.view(x, y)      the pressure lens on and the camera on a plot, for a window capture
(() => {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb === undefined ? "ERR:" + e : fb; } };
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) => GameplayMap.getPlotDistance(a.x, a.y, b.x, b.y);
  const B = (globalThis.blob && globalThis.blob.B) || { log: [], seen: {}, order: [], scale: 1, east: 60000, west: 1500, watch: ["65,17", "63,14", "63,9", "63,10"] };
  const me = () => GameContext.localPlayerID;
  const K = (l) => l.x + "," + l.y;
  const unK = (k) => { const [x, y] = k.split(",").map(Number); return { x, y }; };
  const around = (l, r) => GameplayMap.getPlotIndicesInRadius(l.x, l.y, r).map((i) => GameplayMap.getLocationFromIndex(i));
  const settlements = (o) => safe(() => Players.get(o).Cities.getCities() || [], []);
  const terrainName = (l) => safe(() => GameInfo.Terrains.lookup(GameplayMap.getTerrainType(l.x, l.y)).TerrainType, "?");
  const featureName = (l) => safe(() => { const f = GameplayMap.getFeatureType(l.x, l.y); return f >= 0 ? GameInfo.Features.lookup(f).FeatureType : ""; }, "");
  const land = (l) => !GameplayMap.isWater(l.x, l.y) && !GameplayMap.isImpassable(l.x, l.y);
  const cityAt = (l) => safe(() => { const c = MapCities.getCity(l.x, l.y); return c ? c.id : null; }, null);
  const majors = () => { const out = []; for (let p = 0; p < 64; p++) { const P = safe(() => Players.get(p), null); if (P && P.isMajor && P.isAlive) out.push(p); } return out; };
  let mods = null;
  async function load() {
    if (mods) return mods;
    const tryImport = async (p) => { try { return await import("/cultural-diffusion/ui/" + p); } catch (e1) { return await import("fs://game/cultural-diffusion/ui/" + p); } };
    mods = {
      E: await tryImport("cd-eligibility.js"), T: await tryImport("cd-terrain.js"), C: await tryImport("cd-config.js"),
      L: await tryImport("cd-pressure-lens.js"), H: await tryImport("cd-pressure-tooltip.js"), F: await tryImport("cd-field.js"),
    };
    return mods;
  }
  function rawState() { return safe(() => JSON.parse(Configuration.getGame().getValue("CulturalDiffusionState_v2")).data, null); }
  function writeState(s) { Configuration.editGame().setValue("CulturalDiffusionState_v2", JSON.stringify({ v: 2, data: s })); }

  async function found() {
    if (settlements(me()).length) return true;
    for (const id of safe(() => Players.get(me()).Units.getUnitIds(), []) || []) {
      const u = safe(() => Units.get(id), null);
      if (!u || !/SETTLER|FOUNDER/.test(String(safe(() => GameInfo.Units.lookup(u.type).UnitType, "")))) continue;
      safe(() => Game.UnitOperations.sendRequest(id, UnitOperationTypes.FOUND_CITY, {}));
      for (let k = 0; k < 20 && !settlements(me()).length; k++) await later(500);
      return settlements(me()).length > 0;
    }
    return false;
  }

  // East = higher x than the capital. A flat open tile is one the bench can turn into a mountain or a marsh.
  const flatOpen = (l) => land(l) && GameplayMap.getOwner(l.x, l.y) === -1 && !/WONDER/.test(featureName(l)) &&
    safe(() => GameplayMap.getResourceType(l.x, l.y), -1) === -1 && /FLAT/.test(terrainName(l));

  async function init() {
    const ok = await found();
    const cap = settlements(me())[0];
    if (!ok || !cap) return { ok: false, why: "no capital" };
    B.cap = { x: cap.location.x, y: cap.location.y }; B.capId = cap.id.id;
    B.rival = majors().find((p) => p !== me());
    const east = (l) => l.x > B.cap.x;
    const ring = (r) => around(B.cap, r).filter((l) => dist(B.cap, l) === r);
    const rivalSite = ring(4).filter((l) => east(l) && land(l) && GameplayMap.getOwner(l.x, l.y) === -1)
      .sort((a, b) => Math.abs(a.y - B.cap.y) - Math.abs(b.y - B.cap.y))[0];
    B.rivalSite = rivalSite ? { x: rivalSite.x, y: rivalSite.y } : null;
    const farFromRival = (l) => !B.rivalSite || dist(l, B.rivalSite) >= 3;
    const r3 = ring(3).filter((l) => east(l) && flatOpen(l) && farFromRival(l));
    B.mountain = r3[0] ? { x: r3[0].x, y: r3[0].y } : null;
    const marsh = r3.find((l) => B.mountain && dist(l, B.mountain) >= 2);
    B.marsh = marsh ? { x: marsh.x, y: marsh.y } : null;
    const town = ring(5).filter((l) => l.x < B.cap.x && land(l) && GameplayMap.getOwner(l.x, l.y) === -1)
      .sort((a, b) => Math.abs(a.y - B.cap.y) - Math.abs(b.y - B.cap.y))[0];
    B.townSite = town ? { x: town.x, y: town.y } : null;
    const s = rawState();
    return { ok: true, me: me(), cap: B.cap, rival: B.rival, rivalSite: B.rivalSite, mountain: B.mountain, marsh: B.marsh,
      townSite: B.townSite, stateKeys: s ? Object.keys(s) : null };
  }

  // Our culture, poured in at the capital and its ring 1 each pass; the field update carries it outward with the
  // terrain caps, so mountains and marsh get less of it, as in a real game.
  function seed() {
    const s = rawState() || { field: {}, claims: {}, locked: {}, pending: {}, occupation: {}, cityHold: {}, monoTurn: 0 };
    const pid = String(me());
    for (const c of settlements(me())) {
      const at = { x: c.location.x, y: c.location.y };
      for (const l of around(at, 1)) {
        const base = c.id.id === B.capId ? (l.x > at.x ? B.east : l.x < at.x ? B.west : 20000) : 3000;
        const k = K(l);
        s.field[k] = s.field[k] || {};
        s.field[k][pid] = Math.max(s.field[k][pid] || 0, base * B.scale);
      }
    }
    writeState(s);
  }

  function mine() { return settlements(me()).map((c) => ({ id: c.id.id, loc: { x: c.location.x, y: c.location.y } })); }
  function nearestOf(l, list) { let best = null; for (const c of list) { const d = dist(c.loc, l); if (!best || d < best.d) best = { ...c, d }; } return best; }
  function sharedByTwo(l, list) { return list.filter((c) => dist(c.loc, l) <= 3).length > 1; }

  // A gap: an inward neighbour (closer to the claimant's nearest settlement) that is open land the claimant doesn't
  // hold. Each is labelled with what it is, so the exempt kinds (rough ground, a rival's centre) can be told apart.
  function gapsFor(owner, tiles, list, M) {
    const out = [];
    const normalMax = M ? M.C.CONFIG.normalMax : 0.4;
    for (const t of tiles) {
      const here = nearestOf(t, list);
      if (!here || here.d < 2) continue;
      for (const n of around(t, 1)) {
        if (n.x === t.x && n.y === t.y) continue;
        const inward = nearestOf(n, list);
        if (!inward || inward.d >= here.d) continue;
        const o = GameplayMap.getOwner(n.x, n.y);
        if (o === owner || !land(n)) continue;
        const cap = M ? safe(() => M.T.terrainCap(n, M.C.CONFIG), 1) : 1;
        const kind = o === -1 ? (sharedByTwo(n, list) ? "shared" : "open") : !safe(() => Players.get(o).isMajor, false) ? "minor" : (cityAt(n) && safe(() => MapCities.getDistrict(n.x, n.y), null) ? "rival-district" : "rival");
        out.push({ tile: K(t), ring: here.d, inward: K(n), kind, owner: o, terrain: terrainName(n), feature: featureName(n),
          rough: cap < normalMax, center: safe(() => { const c = MapCities.getCity(n.x, n.y); const cc = c && Cities.get(c); return !!cc && cc.location.x === n.x && cc.location.y === n.y; }, false) });
      }
    }
    return out;
  }

  async function read(label) {
    const M = await load().catch((e) => { B.importError = String(e); return null; });
    const st = rawState() || { field: {}, claims: {} };
    const list = mine();
    const pid = me();
    const o = { label, turn: safe(() => Game.turn), scale: B.scale, importOk: !!M, importError: B.importError || null };
    const region = around(B.cap, 8);
    const mineTiles = region.filter((l) => GameplayMap.getOwner(l.x, l.y) === pid);
    // New claims since the last read, in order, with their ring and our stock when taken.
    const fresh = [];
    for (const l of mineTiles) {
      const k = K(l);
      if (B.seen[k]) continue;
      B.seen[k] = true;
      const n = nearestOf(l, list);
      const c = st.claims[k];
      fresh.push({ k, ring: n ? n.d : null, stock: Math.round(((st.field[k] || {})[pid]) || 0), byMod: !!c && c.by === pid,
        city: cityAt(l), nearestCity: n ? n.id : null, terrain: terrainName(l), feature: featureName(l) });
    }
    B.order.push(...fresh.map((f) => f.k));
    o.newTiles = fresh;
    o.ringsHeld = {}; for (const l of mineTiles) { const n = nearestOf(l, list); if (n) o.ringsHeld[n.d] = (o.ringsHeld[n.d] || 0) + 1; }
    o.ringsOfCap = {}; for (let r = 1; r <= 7; r++) { const ring = around(B.cap, r).filter((l) => dist(B.cap, l) === r && land(l)); o.ringsOfCap[r] = { land: ring.length, ours: ring.filter((l) => GameplayMap.getOwner(l.x, l.y) === pid).length, rival: ring.filter((l) => { const w = GameplayMap.getOwner(l.x, l.y); return w >= 0 && w !== pid; }).length }; }
    o.eastWest = { east: mineTiles.filter((l) => l.x > B.cap.x).map((l) => dist(B.cap, l)).reduce((a, b) => Math.max(a, b), 0),
      west: mineTiles.filter((l) => l.x < B.cap.x).map((l) => dist(B.cap, l)).reduce((a, b) => Math.max(a, b), 0) };
    o.gaps = gapsFor(pid, mineTiles, list, M).filter((g) => g.kind !== "shared");
    o.hardGaps = o.gaps.filter((g) => !g.rough && !g.center && g.kind !== "minor");
    // The AI's culture claims near us (claims booked by another major).
    const aiClaims = Object.keys(st.claims).filter((k) => st.claims[k].by !== pid && !st.claims[k].settlement).map(unK)
      .filter((l) => GameplayMap.getOwner(l.x, l.y) === st.claims[K(l)].by);
    o.aiClaims = aiClaims.map(K);
    o.aiGaps = [];
    for (const p of new Set(aiClaims.map((l) => st.claims[K(l)].by))) {
      const theirs = settlements(p).map((c) => ({ id: c.id.id, loc: { x: c.location.x, y: c.location.y } }));
      o.aiGaps.push(...gapsFor(p, aiClaims.filter((l) => st.claims[K(l)].by === p), theirs, M).map((g) => ({ ...g, by: p })));
    }
    o.marsh = B.marsh ? { owner: GameplayMap.getOwner(B.marsh.x, B.marsh.y), feature: featureName(B.marsh), stock: Math.round(((st.field[K(B.marsh)] || {})[pid]) || 0) } : null;
    o.mountain = B.mountain ? { owner: GameplayMap.getOwner(B.mountain.x, B.mountain.y), terrain: terrainName(B.mountain), stock: Math.round(((st.field[K(B.mountain)] || {})[pid]) || 0) } : null;
    if (B.marsh) o.behindMarsh = around(B.marsh, 1).filter((n) => dist(B.cap, n) === dist(B.cap, B.marsh) + 1).map((n) => ({ k: K(n), owner: GameplayMap.getOwner(n.x, n.y) }));
    if (B.mountain) o.behindMountain = around(B.mountain, 1).filter((n) => dist(B.cap, n) === dist(B.cap, B.mountain) + 1).map((n) => ({ k: K(n), owner: GameplayMap.getOwner(n.x, n.y) }));
    // Shared tiles: unowned land in the rings of two of our settlements; they should stay unowned until the game hands them out.
    o.shared = region.filter((l) => land(l) && sharedByTwo(l, list)).map((l) => ({ k: K(l), owner: GameplayMap.getOwner(l.x, l.y), byMod: !!st.claims[K(l)] && st.claims[K(l)].by === pid }));
    // The rival's tiles in our rings 3 and 4.
    if (B.rival !== undefined) o.rivalInOurRings = region.filter((l) => GameplayMap.getOwner(l.x, l.y) === B.rival).map((l) => ({ k: K(l), ring: dist(B.cap, l) })).filter((t) => t.ring <= 5);
    if (M) {
      const cfg = { ...M.C.CONFIG };
      const waiting = [];
      for (const l of region) {
        if (GameplayMap.getOwner(l.x, l.y) === pid) continue;
        const why = safe(() => M.E.claimGateBlocked(l, GameplayMap.getOwner(l.x, l.y), pid, cfg, { cities: M.E.cityListOf(pid) }), "ERR");
        if (why === "gap-behind") waiting.push(l);
      }
      const lens = safe(() => M.L.__test.pressureTiles(), []);
      const lensKeys = new Set((lens || []).map((t) => t.x + "," + t.y));
      const hover = (l) => safe(() => { const r = M.H.__test.resolve(l); return r ? r.rows.filter((x) => !x.__sep).map((x) => x.name + "=" + x.value) : null; }, "ERR");
      o.waiting = waiting.map((l) => ({ k: K(l), ring: dist(B.cap, l), lensTints: lensKeys.has(K(l)), hover: hover(l) }));
      const tinted = (lens || []).filter((t) => t.leader === pid).slice(0, 3);
      o.lensSample = tinted.map((t) => ({ k: t.x + "," + t.y, progress: Math.round(t.progress * 100) / 100, hover: hover(t) }));
      o.lensCount = lensKeys.size;
      // Every tile the lens tints for us, with its own terrain and the pace line, so a tile that stops rising can be
      // checked against what the hover promises (2026-10-29: (65,17) sat at 68% under "~1 turn" for eight passes).
      const river = (l) => safe(() => GameplayMap.getRiverType(l.x, l.y), null);
      const pace = (rows) => (Array.isArray(rows) ? (rows.find((r) => r.startsWith("At current pace=")) || "").slice(16) : null);
      const ours = (lens || []).filter((t) => t.leader === pid);
      const t0 = Date.now();
      for (const t of ours) hover(t);
      o.hoverMs = ours.length ? Math.round(((Date.now() - t0) / ours.length) * 10) / 10 : null;
      o.paceSample = ours.map((t) => ({ k: t.x + "," + t.y,
        stock: Math.round(((st.field[t.x + "," + t.y] || {})[pid]) || 0), terrain: terrainName(t), feature: featureName(t),
        river: river(t), pace: pace(hover(t)),
        // Neighbours holding our culture but not past their crossing gate onto this tile yet.
        under: around(t, 1).filter((n) => K(n) !== t.x + "," + t.y).map((n) => {
          const v = ((st.field[K(n)] || {})[pid]) || 0;
          return { k: K(n), stock: Math.round(v), gate: safe(() => M.T.stepGate(n, t, cfg), null) };
        }).filter((n) => n.stock > 0 && n.gate != null && n.stock <= n.gate) }));
      for (const k of B.watch) {
        const l = unK(k);
        // The patch the estimate projects, with each node's plot and terrain, so a reading can be replayed offline.
        const patch = safe(() => M.H.__test.patchAround(st.field, l, pid, cfg, M.H.__test.lastTrend()), null);
        const verdict = safe(() => M.F.pressureVerdict(st.field[k] || {}, GameplayMap.getOwner(l.x, l.y), [], cfg), null);
        (o.watched = o.watched || []).push({ k, patch, verdict, estimate: safe(() => M.F.estimateTurnsToFlip(verdict, patch, cfg), "ERR"),
          owner: GameplayMap.getOwner(l.x, l.y), terrain: terrainName(l),
          feature: featureName(l), river: river(l), stock: Math.round(((st.field[k] || {})[pid]) || 0), hover: hover(l),
          around: around(l, 1).filter((n) => K(n) !== k).map((n) => ({ k: K(n), terrain: terrainName(n), river: river(n),
            stock: Math.round(((st.field[K(n)] || {})[pid]) || 0) })) });
      }
      // The mountain waits for the land around it: what the gate says, and who holds each neighbour.
      if (B.mountain) {
        o.mountain.why = safe(() => M.E.claimGateBlocked(B.mountain, o.mountain.owner, pid, cfg, { cities: M.E.cityListOf(pid) }), "ERR");
        o.mountain.lensTints = lensKeys.has(K(B.mountain));
        o.mountain.hover = hover(B.mountain);
        o.mountain.around = around(B.mountain, 1).filter((n) => K(n) !== K(B.mountain))
          .map((n) => ({ k: K(n), owner: GameplayMap.getOwner(n.x, n.y), land: land(n), terrain: terrainName(n) }));
      }
    }
    B.log.push(o);
    return o;
  }

  async function pass(label) {
    seed();
    const r = safe(() => globalThis.culturalDiffusion.runNow(), "ERR");
    await later(5000);
    const o = await read(label);
    o.pass = r === undefined ? "ok" : r;
    return o;
  }

  async function view(x, y) {
    const LM = await import("/core/ui/lenses/lens-manager.js").then((m) => m.default).catch((e) => "ERR:" + e);
    const set = typeof LM === "string" ? LM : safe(() => LM.setActiveLens("cd-pressure-lens"));
    const cam = safe(() => Camera.lookAtPlot({ x, y }));
    await later(1500);
    return { set, cam, lens: typeof LM === "string" ? LM : safe(() => LM.getActiveLens()) };
  }

  // A settlement for any player, the way the bench's own fallback does it; waits until the map shows it.
  async function place(at, owner) {
    if (!at) return { ok: false, why: "no site" };
    safe(() => Game.PlayerOperations.sendRequest(GameContext.localPlayerID, "CREATE_ELEMENT", { Kind: "CITY", Location: at, Owner: owner }));
    for (let k = 0; k < 20; k++) {
      await later(500);
      const c = cityAt(at);
      if (c) return { ok: true, at, owner, mapOwner: GameplayMap.getOwner(at.x, at.y), isTown: safe(() => Cities.get(c).isTown) };
    }
    return { ok: false, at, owner, why: "nothing on the map after 10 s" };
  }

  function who(p) {
    const P = safe(() => Players.get(p), null);
    return P ? { p, major: P.isMajor, minor: P.isMinor, alive: P.isAlive, civ: safe(() => GameInfo.Civilizations.lookup(P.civilizationType).CivilizationType, "?") } : null;
  }

  globalThis.blob = { B, init, pass, read, view, seed, place, who, setScale: (n) => { B.scale = n; return n; }, log: () => B.log };
  return "blob installed";
})();
