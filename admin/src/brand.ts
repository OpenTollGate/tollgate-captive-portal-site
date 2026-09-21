// Build-time brand selection.
//
// One build ships exactly one skin. The default is TollGate; net4sats builds
// pass VITE_BRAND=net4sats. Keeping the brand config in-repo (rather than in a
// separate `configui` project) was a deliberate consolidation decision.
//
// Asset paths are relative to the app base, so callers should pass them through
// `withBase()` from './paths'.

export type BrandId = 'tollgate' | 'net4sats';

export interface Brand {
  id: BrandId;
  name: string;
  domain: string;
  tagline: string;
  poweredBy: string;
  website: string;
  version: string;
  /** colour logo (on light backgrounds) */
  logo: string;
  /** white logo (on dark backgrounds) */
  logoWhite: string;
  /** colour icon (favicon / PWA) */
  icon: string;
  /** white icon */
  iconWhite: string;
  themeColor: string;
  sessionKey: string;
  sessionUser: string;
}

const BRANDS: Record<BrandId, Brand> = {
  tollgate: {
    id: 'tollgate',
    name: 'TollGate',
    domain: 'tollgate.lan',
    tagline: 'Router Admin Dashboard',
    poweredBy: 'Powered by TollGate',
    website: 'https://tollgate.me/',
    version: 'TollGate v0.6.0-alpha2',
    logo: 'assets/brand/tollgate/logo-colour.png',
    logoWhite: 'assets/brand/tollgate/logo-white.png',
    icon: 'assets/brand/tollgate/icon-colour.png',
    iconWhite: 'assets/brand/tollgate/icon-white.png',
    themeColor: '#FF6961',
    sessionKey: 'tollgate_session',
    sessionUser: 'tollgate_user',
  },
  net4sats: {
    id: 'net4sats',
    name: 'net4sats',
    domain: 'net4sats.lan',
    tagline: 'Router Admin Dashboard',
    poweredBy: 'Powered by Lightning',
    website: 'https://net4sats.cash',
    version: 'net4sats v1.0',
    logo: 'assets/brand/net4sats/logo-colour.png',
    logoWhite: 'assets/brand/net4sats/logo-white.png',
    icon: 'assets/brand/net4sats/icon-colour.png',
    iconWhite: 'assets/brand/net4sats/icon-white.png',
    themeColor: '#111111',
    sessionKey: 'net4sats_session',
    sessionUser: 'net4sats_user',
  },
};

const requested = (import.meta.env.VITE_BRAND as BrandId) || 'tollgate';

export const BRAND: Brand = BRANDS[requested] ?? BRANDS.tollgate;
