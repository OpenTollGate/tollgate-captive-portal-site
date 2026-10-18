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
  // composing a second one, so the two surfaces cannot disagree.
  const poweredBy = desc.poweredBy?.trim() || `Powered by ${name}`;

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
 * icons beside it said net4sats. Two surfaces of one app disagreeing is the same defect
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
