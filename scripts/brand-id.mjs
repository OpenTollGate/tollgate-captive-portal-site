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
// Plain ESM with no dependencies on purpose: `vite.config.mjs` (loaded by Vite
// before any app code) and `scripts/build-all.mjs` (plain node) both import it.

export const DEFAULT_BRAND_ID = 'tollgate';

// Identifier alphabet only: starts alphanumeric, then alphanumerics, dot,
// underscore or hyphen. No separators, no leading dot, no whitespace.
const BRAND_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

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

/**
 * Look a descriptor module up by id, case-insensitively, from an
 * `import.meta.glob`-style map keyed by file path.
 */
export function findDescriptor(modules, id) {
  const wanted = normalizeBrandId(id);
  if (!wanted) return null;
  for (const [path, mod] of Object.entries(modules ?? {})) {
    if (descriptorIdFromPath(path) === wanted) {
      return (mod && mod.default) || mod || null;
    }
  }
  return null;
}
