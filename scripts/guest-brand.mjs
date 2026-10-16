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
