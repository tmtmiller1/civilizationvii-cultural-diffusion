// Off-engine stand-in for /core/ui/lenses/lens-manager.js (tests/loader.mjs routes it here). It records the layers
// and lenses that register and which lens is active, so a suite can assert the Cultural Pressure lens registered
// and that its key switches it.
const LensManager = {
  layers: new Map(),
  lenses: new Map(),
  active: "fxs-default-lens",
  registerLensLayer(id, layer) {
    this.layers.set(id, layer);
  },
  registerLens(id, lens) {
    this.lenses.set(id, lens);
  },
  getActiveLens() {
    return this.active;
  },
  setActiveLens(id) {
    this.active = id;
  }
};

export default LensManager;
