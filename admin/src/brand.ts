// Brand selection for the admin board.
//
// This repository ships exactly ONE skin: the generic TollGate default. It is
// the *protocol* side of the TollGate UI. A branded distribution operator
// supplies its own skin at build time without forking this repo: drop
// `brand/<id>.json` + `public/assets/brand/<id>/` assets into the build, then
// build with `VITE_BRAND=<id>`. Env/assets/config only.
//
// Loading uses import.meta.glob with { eager: true } so the descriptor set is
// resolved at build time and the active descriptor is bundled into the output
// (a distribution build ships exactly its own skin).

import {
  resolveBrand,
  type BrandDescriptor,
  loadBrandDescriptors,
} from './brand-core';

const requested = (import.meta.env.VITE_BRAND as string | undefined) || undefined;

// eager + import.meta.glob: keys are the descriptor file paths.
const descriptorModules = import.meta.glob('../../brand/*.json', { eager: true }) as Record<
  string,
  { default: BrandDescriptor }
>;

const bundled = loadBrandDescriptors(descriptorModules);

export const BRAND = resolveBrand(requested, bundled);

// Re-export the type so callers can annotate without importing brand-core.
export type { Brand, BrandDescriptor } from './brand-core';
export { DEFAULT_BRAND_ID } from './brand-core';
