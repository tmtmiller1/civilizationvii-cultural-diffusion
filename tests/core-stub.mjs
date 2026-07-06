// Off-engine stub for engine-served modules (/core/**, /base-standard/**).
// The Options-screen module imports these; the gameplay tests never exercise
// them, so a permissive proxy that returns benign values is enough to load.
const handler = {
  get: (_t, prop) => {
    if (prop === "addOption") return () => {};
    return new Proxy(() => {}, handler);
  }
};
export const CategoryType = new Proxy({}, handler);
export const OptionType = new Proxy({}, handler);
export const Options = { addOption: () => {} };
export const CategoryData = new Proxy({}, handler);
export default new Proxy(() => {}, handler);
