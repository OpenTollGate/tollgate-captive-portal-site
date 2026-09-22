// Canonical brand-id normalisation for the build tooling.
//
// The brand slot contract is: one build ships one skin, selected by
// `VITE_BRAND=<id>`, where `<id>` is the file name (minus `.json`) of a
// descriptor in `admin/brand/`. The id is an *identifier*, never a path: it is
// used to build filesystem paths (`admin/brand/<id>.json`,
// `public/assets/brand/<id>/`), so anything that could escape the slot
// (`../`, `/`, a leading dot) must be rejected rather than joined.
//
// This module is the single build-side implementation of that rule; the runtime
// implementation lives in `admin/src/brand-core.ts`. The two are kept in step by
// `tests/unit/brand.test.js` ("build-side and runtime id normalisation agree"),
// so a change on one side cannot silently drift from the other.
//
// "In the slot" means exactly what the runtime `import.meta.glob('.../*.json')`
// sees: a **file** whose name ends in lowercase `.json`. `DESCRIPTOR_FILE_RE` is
// deliberately case-sensitive so a `README.md` (this directory ships one) or a
// `ACME.JSON` can never become a phantom brand id that the runtime glob misses.
//
// Plain ESM with no dependencies on purpose: `vite.config.mjs` (loaded by Vite
// before any app code) and `scripts/build-all.mjs` (plain node) both import it.

export const DEFAULT_BRAND_ID = 'tollgate';

// Identifier alphabet only: starts alphanumeric, then alphanumerics, dot,
// underscore or hyphen. No separators, no leading dot, no whitespace.
const BRAND_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Matches exactly what the runtime descriptor glob (`brand/*.json`) matches. */
export const DESCRIPTOR_FILE_RE = /\.json$/;

/** Descriptor fields the runtime requires; mirror of brand-core.ts. */
export const REQUIRED_DESCRIPTOR_FIELDS = [
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
 * Normalise a requested brand id: trim, lowercase, and reject anything that is
 * not a plain identifier. Returns `''` for an unusable value (callers fall back
 * to {@link DEFAULT_BRAND_ID}); never throws.
 */
export function normalizeBrandId(requested) {
  const cleaned = String(requested ?? '').trim().toLowerCase();
  return BRAND_ID_RE.test(cleaned) ? cleaned : '';
}

/** True when `id` is already a usable (normalised) brand id. */
export function isBrandId(id) {
  return typeof id === 'string' && BRAND_ID_RE.test(id);
}

/** Derive a brand id from a descriptor file name (`Acme.json` -> `acme`). */
export function descriptorIdFromPath(path) {
  const leaf = String(path ?? '').split(/[/\\]/).pop() ?? '';
  return leaf.trim().replace(/\.json$/i, '').toLowerCase();
}

/** True when a directory entry name is a descriptor file (`tollgate.json`). */
export function isDescriptorFile(name) {
  return DESCRIPTOR_FILE_RE.test(String(name ?? ''));
}

/**
 * Look a descriptor module up by id, case-insensitively, from an
 * `import.meta.glob`-style map keyed by file path.
 */
export function findDescriptor(modules, id) {
  const wanted = normalizeBrandId(id);
  if (!wanted) return null;
  for (const [path, mod] of Object.entries(modules ?? {})) {
    if (isDescriptorFile(path) && descriptorIdFromPath(path) === wanted) {
      return (mod && mod.default) || mod || null;
    }
  }
  return null;
}

/**
 * Validate a descriptor's required fields. Mirror of `validateDescriptor` in
 * `admin/src/brand-core.ts`; the build fails on a descriptor the runtime would
 * reject, instead of emitting a manifest for a skin the app cannot render.
 */
export function validateDescriptor(desc, source = 'brand descriptor') {
  for (const field of REQUIRED_DESCRIPTOR_FIELDS) {
    const value = desc?.[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `${source} for "${desc?.id ?? '<unknown>'}" missing required field "${field}"`,
      );
    }
  }
}
