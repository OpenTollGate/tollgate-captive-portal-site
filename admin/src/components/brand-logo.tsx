// The brand wordmark, palette-aware.
//
// WHY THIS EXISTS: the descriptor exposes two logo assets — `logo`
// (`logo-colour.png`, a #090909 wordmark meant for light grounds) and
// `logoWhite` (`logo-white.png`, #ffffff, meant for dark grounds). The board
// used `BRAND.logo` everywhere, so on the DARK palette — which is both the
// default and the TollGate identity — the wordmark painted #090909 on the
// #14161d page: **1.10:1**. That is invisible, and it is the same class of bug
// as the reported "white is hard to read": the ink and its ground were chosen
// independently of each other.
//
// FIX: pick the asset that matches the palette actually in effect, using
// `<picture>` + `prefers-color-scheme` — the same mechanism the guest portal's
// header already uses in `src/App.jsx`. No JS, no flash of the wrong mark, and
// it keeps working when the OS theme flips at runtime.
//
// Measured wordmark-on-ground (tools/contrast.py `--logo`):
//   logo-colour #090909 on dark page #14161d   1.10:1   (was shipped)
//   logo-white  #ffffff on dark page #14161d  18.07:1   (dark default)
//   logo-colour #090909 on light page #f6f7fa 18.59:1   (light opt-in)
import { BRAND } from '../brand';
import { withBase } from '../lib/paths';

export default function BrandLogo({
  height,
  marginBottom = '0.4rem',
}: {
  height: string;
  marginBottom?: string;
}) {
  // The opt-in island skin is dark even when the OS asks for the light
  // palette, so the light-mode dark-ink wordmark would disappear. Force the
  // white mark on that skin.
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('theme-cobrador-island')) {
    return (
      <img
        src={withBase(BRAND.logoWhite)}
        alt={BRAND.name}
        style={{ height, marginBottom }}
      />
    );
  }
  return (
    <picture>
      {/* Light palette: the dark-ink wordmark, because the white one is
          1.07:1 on #f6f7fa. Listed FIRST so it wins under the media query. */}
      <source srcSet={withBase(BRAND.logo)} media="(prefers-color-scheme: light)" />
      <img
        src={withBase(BRAND.logoWhite)}
        alt={BRAND.name}
        style={{ height, marginBottom }}
      />
    </picture>
  );
}
