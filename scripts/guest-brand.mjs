// Guest-side branding from the same brand descriptor that brands the admin board.
//
// WHY THIS EXISTS
//
// The brand slot (`admin/brand/<id>.json` + `VITE_BRAND`) brands the ADMIN app. The
// guest portal — the page a CUSTOMER sees on the captive network — takes its visible
// wording from `public/locales/en.json` (fetched at runtime) and its PWA identity from
// `public/manifest.json` (static). Neither had a brand input, so a branded build showed
// the operator's brand on the admin board and "Powered by TollGate" to guests.
//
// DESIGN RULES, mirroring the admin slot so there is ONE convention:
//
//   * A missing or unusable descriptor yields `null` — callers then change NOTHING. An
//     unbranded build must be byte-identical to what upstream ships.
//   * The descriptor is the single source: no second brand file, no new env var.
//     `VITE_BRAND` already selects it; this module only reads the fields it needs.
//   * Structural fields (manifest icons, start_url, display, background_color) are never
//     rewritten — branding is words and colour, not layout.

import { DEFAULT_BRAND_ID } from './brand-id.mjs';
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** A descriptor must carry these to brand anything; otherwise we change nothing. */
const REQUIRED = ['id', 'name'];

/** Upstream's default theme colour, kept as the fallback so nothing shifts silently. */
const DEFAULT_THEME = '#000000';

/**
 * Derive the guest-facing branding from a brand descriptor.
 *
 * @param {object|null|undefined} desc the parsed `admin/brand/<id>.json`
 * @returns {{manifest: object, strings: object}|null} null when there is nothing to apply
 */
export function guestBrandingFrom(desc) {
  if (!desc || typeof desc !== 'object') return null;
  for (const f of REQUIRED) {
    if (typeof desc[f] !== 'string' || !desc[f].trim()) return null;
  }

  const name = desc.name.trim();
  // The guest page's own title. Kept distinct from the admin's "Router Admin Dashboard"
  // because they are different surfaces seen by different people.
  const guestName = desc.guestName?.trim() || `${name} Captive Portal`;
  const tagline = desc.tagline?.trim() || 'Pay-as-you-go internet access';
  // The descriptor already carries a whole attribution line; reuse it rather than
  // composing a second one, so the two surfaces cannot disagree. The guest footer
  // renders this through i18next <Trans> where <1>…</1> wraps the LINKED name — a
  // branded line that drops the markup silently loses the outbound link and the
  // trailing tagline, so the fallback composes it the same way.
  const poweredBy = desc.poweredBy?.trim() || `Powered by <1>${name}</1> – Pay-as-you-go internet access`;

  return {
    manifest: {
      name: guestName,
      short_name: name,
      theme_color: desc.themeColor || DEFAULT_THEME,
    },
    strings: {
      html_title: guestName,
      html_description: guestName,
      header_image_alt: `${name} Logo`,
      powered_by: poweredBy,
    },
  };
}

/**
 * Rewrite the ADMIN app's index.html for a brand.
 *
 * WHY: the admin UI was half-branded. The favicon and manifest already came from the brand
 * slot, but `<title>` was the hard-coded literal "TollGate Admin" and theme-color was the
 * hard-coded "#111" — so the tab a router owner looks at still said TollGate while the
 * icons beside it said the operator's brand. Two surfaces of one app disagreeing is the same defect
 * the guest-page branding exists to prevent.
 *
 * No descriptor (or one missing the fields) returns the input UNCHANGED, byte for byte, so
 * an unbranded build cannot be perturbed by this.
 *
 * @param {string} html the raw `admin/index.html`
 * @param {object|null|undefined} desc the parsed `admin/brand/<id>.json`
 * @returns {string} the page to write
 */
export function adminHTMLFrom(html, desc) {
  if (typeof html !== 'string' || !guestBrandingFrom(desc)) return html;
  // The generic default descriptor describes the SAME product the page already ships:
  // its title is "TollGate Admin" and its theme is the page's own #111. Rewriting to the
  // descriptor's values would CHANGE upstream's page (#111 -> #FF6961, "TollGate Admin"
  // -> "TollGate"), which is exactly the unbranded regression this must never cause.
  // Only a non-default brand may rewrite the chrome.
  if (!desc.id || String(desc.id).trim().toLowerCase() === DEFAULT_BRAND_ID) return html;
  const name = desc.name.trim();
  const title = desc.adminTitle?.trim() || name;
  const theme = desc.themeColor || DEFAULT_THEME;

  let out = html;
  // <title> — replace the whole element's text.
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  // theme-color — replace the content attribute only, keeping the tag shape.
  out = out.replace(
    /(<meta[^>]*name=["']theme-color["'][^>]*content=["'])[^"']*(["'])/i,
    `$1${theme}$2`,
  );
  return out;
}

/**
 * Apply guest branding to a manifest and a locale's strings, returning NEW objects.
 *
 * With no usable descriptor both inputs are returned unchanged (same values), so a
 * caller can always write the result without a branch — and an unbranded build therefore
 * writes back exactly what it read.
 *
 * @param {object} manifest the parsed `public/manifest.json`
 * @param {object} strings  the parsed `public/locales/en.json`
 * @param {object|null} desc the brand descriptor
 */
export function applyGuestBranding(manifest, strings, desc) {
  const b = guestBrandingFrom(desc);
  if (!b) return { manifest, strings };
  return {
    // Spread preserves every structural field (icons, start_url, display, ...).
    manifest: { ...manifest, ...b.manifest },
    strings: { ...strings, ...b.strings },
  };
}


/**
 * Rewrite the GUEST app's index.html <title> (and meta description) for a brand.
 *
 * WHY: `strings.html_title` already brands the runtime-locale title, but the static
 * `index.html` ships a hard-coded "Tollgate Captive Portal" — that literal is what a
 * browser shows first (tab, bookmarks, OS window list) BEFORE any JS runs, and what
 * crawlers see. The tab said TollGate while the page said the operator's brand: two surfaces of
 * one page disagreeing, the exact defect this module exists to prevent.
 *
 * Rules mirror the rest of this file:
 *   * no descriptor (or one missing the fields) -> the input is returned UNCHANGED,
 *     byte for byte, so an unbranded build cannot be perturbed;
 *   * the descriptor is the single source; the title is `${name} Captive Portal`
 *     unless `guestName` is given, matching guestBrandingFrom exactly;
 *   * a <title> that isn't there means we have nothing to brand -> unchanged.
 *
 * @param {string} html the raw guest `index.html`
 * @param {object|null|undefined} desc the parsed `admin/brand/<id>.json`
 * @returns {string} the page to write
 */
export function guestHTMLFrom(html, desc) {
  if (!html || typeof html !== 'string') return html;
  const b = guestBrandingFrom(desc);
  if (!b) return html;
  // Escape before interpolation: the descriptor is build INPUT from the distribution
  // operator — a hostile or compromised descriptor must not be able to inject markup
  // into the shipped index.html (title AND meta description carry it).
  const esc = (v) => String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const title = esc(b.strings.html_title);
  let out = html;
  let touched = false;
  const titleTag = /<title>([^<]*)<\/title>/;
  if (titleTag.test(out)) {
    out = out.replace(titleTag, `<title>${title}</title>`);
    touched = true;
  }
  const descTag = /<meta\s+name="description"\s+content="([^"]*)"/;
  if (descTag.test(out)) {
    out = out.replace(descTag, `<meta name="description" content="${title}"`);
    touched = true;
  }
  return touched ? out : html;
}


/**
 * The guest header logo's brand-slot path, or null when there is no brand.
 *
 * Mirrors the ADMIN icon convention (`assets/brand/<id>/logo-white.png` — see
 * `assetPaths()` in admin/src/brand-core.ts) so ONE directory shape serves both
 * apps and a skin author copies the same folder into both slots.
 *
 * @param {object|null|undefined} desc the parsed `admin/brand/<id>.json`
 * @returns {string|null} public-dir-relative logo path, or null (no brand)
 */
export function guestLogoPath(desc) {
  const b = guestBrandingFrom(desc);
  if (!b) return null;
  const id = String(desc.id).trim();
  return `assets/brand/${id}/logo-white.png`;
}

/**
 * Copy a brand's guest logo into the guest app's `public/` tree at build time.
 *
 * WHY copy instead of rewrite: the guest header uses a static Vite import for the
 * TollGate logo (bundle-hashed, cache-busted). A runtime path cannot replace a
 * static import without changing what the UNBRANDED build ships. Instead the BUILD
 * copies the brand's `logo-white.png` into `public/assets/brand/<id>/` (exactly how
 * the admin app's brand icons are shipped) and the app resolves it at runtime,
 * falling back to the static import when no brand asset exists — so an unbranded
 * build keeps byte-identical behaviour and assets.
 *
 * @param {string} brandAssetsDir e.g. `admin/public/assets/brand/<id>` (source)
 * @param {string} publicDir the guest app's `public/`
 * @param {string} id the brand id
 * @returns {boolean} true when the guest logo asset was copied
 */
export function copyGuestBrandAssets(brandAssetsDir, publicDir, id) {
  if (!brandAssetsDir || !publicDir || !id) return false;
  const src = path.join(brandAssetsDir, 'logo-white.png');
  if (!existsSync(src)) return false;
  const destDir = path.join(publicDir, 'assets', 'brand', id);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, path.join(destDir, 'logo-white.png'));
  return true;
}


/**
 * Snapshot files and return a restore function. Used by build-all so a branded
 * build can stage brand wording into the tree for vite to pick up and then put
 * the TRACKED sources back byte-identically — even if the build throws.
 *
 * WHY: the first version of guest branding wrote the brand into public/ and
 * index.html and left it there. The next UNbranded build then shipped the brand
 * (cross-build leakage): "guest branding: not selected" printed, "Acme Captive
 * Portal" shipped. A build may stage, but must never leave residue.
 *
 * @param {string[]} files absolute paths to snapshot
 * @returns {() => void} restore() writes the original bytes back
 */
export function buildGuestRestore(files) {
  const snap = (files || []).map((f) => [f, existsSync(f) ? readFileSync(f) : null]);
  return () => {
    for (const [f, bytes] of snap) {
      if (bytes === null) {
        if (existsSync(f)) rmSync(f, { recursive: true, force: true });
      } else {
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(f, bytes);
      }
    }
  };
}
