// Node ESM loader: map the mod's absolute `/cultural-diffusion/...` import
// specifiers to files under the project root so the modules can be unit-tested
// off-engine. Engine-served modules (/core, /base-standard) are routed to a tiny
// stub so the settings/options modules that import them can still be loaded, and
// the lens manager to a stub that records registrations.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loaderDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(loaderDir, "..");
const MODULE_PREFIX = "/cultural-diffusion/";
const CORE_STUB = pathToFileURL(path.join(loaderDir, "core-stub.mjs")).href;
// The lens manager gets a stub of its own that records what registers, so a suite can assert the lens did.
const LENS_MANAGER = "/core/ui/lenses/lens-manager.js";
const LENS_MANAGER_STUB = pathToFileURL(path.join(loaderDir, "lens-manager-stub.mjs")).href;

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith(MODULE_PREFIX)) {
    const mapped = path.join(projectRoot, specifier.slice(MODULE_PREFIX.length));
    return { url: pathToFileURL(mapped).href, shortCircuit: true };
  }
  if (specifier === LENS_MANAGER) return { url: LENS_MANAGER_STUB, shortCircuit: true };
  if (specifier.startsWith("/core/") || specifier.startsWith("/base-standard/")) {
    return { url: CORE_STUB, shortCircuit: true };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
