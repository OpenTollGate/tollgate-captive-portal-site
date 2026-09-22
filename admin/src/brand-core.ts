// Brand-slot resolution, isolated from any UI framework so it can be unit
// tested directly. This is the *protocol* side of the TollGate UI: it ships
// exactly one brand descriptor (the generic default) and exposes a slot for
// distribution operators to drop in their own at build time — env/assets/config
// only, never a fork (consolidation issue: "branding should be config, not
// three trees").
//
// Build-time contract for a brand overlay:
//   - add `admin/brand/<id>.json` — one BrandDescriptor, id = file name;
//   - add logo/icon files to `admin/public/assets/brand/<id>/`;
//   - build with `VITE_BRAND=<id>`.
//
// Logo/icon paths are a *convention* derived from the id, so an overlay only
// has to get its files into the slot; the descriptor holds no asset paths.
//
// This file deliberately never references any company name.

export const DEFAULT_BRAND_ID = 'tollgate';

export interface BrandDescriptor {
  id: string;
  name: string;
  domain: string;
  tagline: string;
  poweredBy: string;
  website: string;
  version: string;
  themeColor: string;
  sessionKey: string;
  sessionUser: string;
}

export interface Brand extends BrandDescriptor {
  logo: string; // colourful logo (light backgrounds)
  logoWhite: string; // white logo (dark backgrounds)
  icon: string; // colourful icon (favicon / PWA)
  iconWhite: string; // white icon
}

const REQUIRED_FIELDS: readonly (keyof BrandDescriptor)[] = [
  'id',
  'name',
  'domain',
  'tagline',
  'poweredBy',
  'website',
  'version',
  'themeColor',
  'sessionKey',
  'sessionUser',
];

/** `repo/admin/brand/acme.json` -> `acme`. Windows-backslash-safe too. */
export function descriptorIdFromPath(path: string): string {
  const leaf = (path.split(/[/\\]/).pop() ?? '').trim();
  return leaf.replace(/\.json$/i, '');
}

/** Validate a descriptor's required fields; throws with a clear message. */
export function validateDescriptor(desc: BrandDescriptor): void {
  for (const field of REQUIRED_FIELDS) {
    const value = (desc as unknown as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `brand descriptor for "${desc.id ?? '<unknown>'}" missing required field "${field}"`,
      );
    }
  }
}

/** Index a set of descriptor modules by id (validating file-name = id). */
export function indexDescriptors(
  modules: Record<string, BrandDescriptor>,
): Record<string, BrandDescriptor> {
  const indexed: Record<string, BrandDescriptor> = {};
  for (const [path, desc] of Object.entries(modules)) {
    const fileId = descriptorIdFromPath(path);
    validateDescriptor(desc);
    if (desc.id && fileId && desc.id !== fileId) {
      throw new Error(
        `brand descriptor at "${path}" declares id "${desc.id}" but its file name is "${fileId}"`,
      );
    }
    indexed[fileId] = desc;
  }
  return indexed;
}

/** Derive the conventional asset paths for a brand id. */
function assetPaths(id: string): Pick<Brand, 'logo' | 'logoWhite' | 'icon' | 'iconWhite'> {
  return {
    logo: `assets/brand/${id}/logo-colour.png`,
    logoWhite: `assets/brand/${id}/logo-white.png`,
    icon: `assets/brand/${id}/icon-colour.png`,
    iconWhite: `assets/brand/${id}/icon-white.png`,
  };
}

/** Flatten an `import.meta.glob` result into an id -> descriptor map. */
export function loadBrandDescriptors(
  modules: Record<string, { default: BrandDescriptor } | BrandDescriptor>,
): Record<string, BrandDescriptor> {
  const out: Record<string, BrandDescriptor> = {};
  for (const [path, mod] of Object.entries(modules)) {
    out[descriptorIdFromPath(path)] = (mod as { default?: BrandDescriptor }).default ??
      (mod as BrandDescriptor);
  }
  return out;
}

/**
 * Resolve the active Brand from a requested id and the bundled descriptor map
 * (as loaded via `import.meta.glob('../../brand/*.json', { eager: true })`).
 * Falls back — loudly — to the generic default for an unknown/empty id.
 */
export function resolveBrand(
  requestedId: string | null | undefined,
  bundled: Record<string, BrandDescriptor>,
): Brand {
  const cleaned = (requestedId ?? '').trim().toLowerCase();
  const descriptors = indexDescriptors(bundled);

  if (!descriptors[DEFAULT_BRAND_ID]) {
    throw new Error(
      `brand slot is broken: no descriptor for the default brand "${DEFAULT_BRAND_ID}"`,
    );
  }

  const chosen = cleaned && descriptors[cleaned] ? descriptors[cleaned] : descriptors[DEFAULT_BRAND_ID];

  if (cleaned && !descriptors[cleaned]) {
    // eslint-disable-next-line no-console
    console.warn(
      `[brand] VITE_BRAND="${requestedId}" not bundled; falling back to "${DEFAULT_BRAND_ID}". ` +
        `Bundled: ${Object.keys(descriptors).join(', ')}`,
    );
  }

  return { ...chosen, ...assetPaths(chosen.id) };
}
