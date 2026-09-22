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
// An id is an **identifier, not a path**: it is used to build the paths above.
// The accepted alphabet is therefore narrow (`[a-z0-9][a-z0-9._-]*`) and the id
// is normalized to lowercase before use, so matching is case-insensitive end to
// end (request, descriptor file name, declared id, asset directory) and a
// path-ish value like `../../etc/passwd` can never reach a filesystem join.
// `scripts/brand-id.mjs` mirrors this rule for the build tooling; the two are
// pinned together by tests/unit/brand.test.js.
//
// This file deliberately never references any company name.

export const DEFAULT_BRAND_ID = 'tollgate';

/** Brand ids are identifiers, not paths — see the file header. */
const BRAND_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

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

/**
 * Trim + lowercase a requested brand id, rejecting anything that is not a plain
 * identifier (returns `''`, so callers fall back to {@link DEFAULT_BRAND_ID}).
 * Mirror of `scripts/brand-id.mjs` `normalizeBrandId`.
 */
export function normalizeBrandId(requested: string | null | undefined): string {
  const cleaned = String(requested ?? '').trim().toLowerCase();
  return BRAND_ID_RE.test(cleaned) ? cleaned : '';
}

/** `repo/admin/brand/acme.json` -> `acme`. Windows-backslash-safe too. */
export function descriptorIdFromPath(path: string): string {
  const leaf = (String(path ?? '').split(/[/\\]/).pop() ?? '').trim();
  return leaf.replace(/\.json$/i, '').toLowerCase();
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

/**
 * Index a set of descriptor modules by **normalized** id (validating that the
 * declared id agrees with the file name, comparison being case-insensitive).
 * The stored descriptor's own `id` is normalized too, because that id is what
 * addresses the asset slot.
 */
export function indexDescriptors(
  modules: Record<string, BrandDescriptor>,
): Record<string, BrandDescriptor> {
  const indexed: Record<string, BrandDescriptor> = {};
  for (const [path, desc] of Object.entries(modules)) {
    const fileId = descriptorIdFromPath(path);
    validateDescriptor(desc);
    const declared = normalizeBrandId(desc.id);
    if (desc.id && fileId && declared !== fileId) {
      throw new Error(
        `brand descriptor at "${path}" declares id "${desc.id}" but its file name is "${fileId}"`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(indexed, fileId)) {
      throw new Error(`duplicate brand descriptor id "${fileId}" (from "${path}")`);
    }
    indexed[fileId] = { ...desc, id: fileId };
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

/** Flatten an `import.meta.glob` result into a normalized id -> descriptor map. */
export function loadBrandDescriptors(
  modules: Record<string, { default: BrandDescriptor } | BrandDescriptor>,
): Record<string, BrandDescriptor> {
  const out: Record<string, BrandDescriptor> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const id = descriptorIdFromPath(path);
    const desc =
      (mod as { default?: BrandDescriptor }).default ?? (mod as BrandDescriptor);
    out[id] = desc ? { ...desc, id } : desc;
  }
  return out;
}

/**
 * Resolve the active Brand from a requested id and the bundled descriptor map
 * (as loaded via `import.meta.glob('../../brand/*.json', { eager: true })`).
 * Matching is case-insensitive. Falls back — loudly — to the generic default for
 * an unknown or unusable id.
 */
export function resolveBrand(
  requestedId: string | null | undefined,
  bundled: Record<string, BrandDescriptor>,
): Brand {
  const raw = String(requestedId ?? '').trim();
  const requested = normalizeBrandId(requestedId);
  const descriptors = indexDescriptors(bundled);

  if (!descriptors[DEFAULT_BRAND_ID]) {
    throw new Error(
      `brand slot is broken: no descriptor for the default brand "${DEFAULT_BRAND_ID}"`,
    );
  }

  const fallback = (): Brand => ({
    ...descriptors[DEFAULT_BRAND_ID],
    ...assetPaths(DEFAULT_BRAND_ID),
  });

  if (!requested) {
    if (raw) {
      // eslint-disable-next-line no-console
      console.warn(
        `[brand] VITE_BRAND="${raw}" is not a valid brand id ` +
          `(expected ${String(BRAND_ID_RE)}); using "${DEFAULT_BRAND_ID}".`,
      );
    }
    return fallback();
  }

  if (!descriptors[requested]) {
    // eslint-disable-next-line no-console
    console.warn(
      `[brand] VITE_BRAND="${raw}" not bundled; falling back to "${DEFAULT_BRAND_ID}". ` +
        `Bundled: ${Object.keys(descriptors).join(', ')}`,
    );
    return fallback();
  }

  return { ...descriptors[requested], ...assetPaths(requested) };
}
