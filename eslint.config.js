// Dev-only ESLint flat config. Enforces the modularization gate (function length +
// cyclomatic complexity) and catches real bugs. Not shipped; excluded from the packaged mod.
// Mirrors the Emigration/Demographics mods' config so all three hold to the same standard.

const ENGINE_GLOBALS = {
  // Civ7 true globals used without importing.
  Game: "readonly",
  GameContext: "readonly",
  Online: "readonly",
  Players: "readonly",
  GameInfo: "readonly",
  GameplayMap: "readonly",
  Configuration: "readonly",
  Locale: "readonly",
  engine: "readonly",
  Database: "readonly",
  Controls: "readonly",
  Cities: "readonly",
  MapUnits: "readonly",
  Units: "readonly",
  Districts: "readonly",
  DistrictTypes: "readonly",
  ComponentID: "readonly",
  MapConstructibles: "readonly",
  Constructibles: "readonly",
  Modding: "readonly",
  UI: "readonly",
  YieldTypes: "readonly",
  DiplomacyPlayerRelationships: "readonly",
  WorldUI: "readonly",
  WorldBuilder: "readonly",
  RiverTypes: "readonly",
  RouteTypes: "readonly",
  CultureSlotTypes: "readonly",
  PlayerIds: "readonly",
  InputActionStatuses: "readonly"
};

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  localStorage: "readonly",
  globalThis: "readonly",
  structuredClone: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  MutationObserver: "readonly",
  CustomEvent: "readonly"
};

export default [
  {
    files: ["ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...ENGINE_GLOBALS, ...BROWSER_GLOBALS }
    },
    rules: {
      // The modularization gate.
      complexity: ["error", 10],
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true }
      ],
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      // Enforced hard ceiling (120). Strings / templates / regex / urls are exempt so data and
      // localized copy aren't penalized; everything else, including comments, must wrap.
      "max-len": [
        "error",
        {
          code: 120,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true
        }
      ],
      "max-params": ["error", 5],
      "max-depth": ["error", 4],
      "max-statements": ["error", 18],
      // Correctness checks.
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      // Match the engine's own `== null` undefined-check idiom.
      eqeqeq: ["error", "always", { null: "ignore" }]
    }
  }
];
