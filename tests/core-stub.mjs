// Off-engine stub for engine-served modules (/core/**, /base-standard/**).
//
// `Options` mirrors the base OptionsModel (core/ui/options/model-options.js, game 1.4.2) for the methods the mod's
// Options registration depends on: init, addInitCallback (including its "already initialized" throw), reInitOptions,
// and addOption. tests/options.mjs relies on these semantics to pin the "options disappear after closing Settings" fix.
const handler = {
  get: () => new Proxy(() => {}, handler)
};

class OptionsModelStub {
  Options = new Map();
  optionsInitCallbacks = [];
  optionsReInitCallbacks = [];

  get data() {
    return this.Options;
  }

  init() {
    this.optionsInitCallbacks.forEach((callback) => callback());
    this.optionsInitCallbacks = [];
  }

  addInitCallback(callback) {
    if (this.optionsReInitCallbacks.length && !this.optionsInitCallbacks.length) {
      throw new Error("Options already initialized, cannot add init callback");
    }
    this.optionsInitCallbacks.push(callback);
    this.optionsReInitCallbacks.push(callback);
  }

  reInitOptions() {
    this.Options.clear();
    this.optionsInitCallbacks = this.optionsReInitCallbacks;
  }

  addOption(info) {
    this.Options.set(info.id, info);
    info.initListener?.(info);
  }
}

export const CategoryType = {};
export const OptionType = { Editor: 0, Checkbox: 1, Dropdown: 2, Slider: 3, Stepper: 4 };
export const Options = new OptionsModelStub();
export const CategoryData = {};
export default new Proxy(() => {}, handler);
