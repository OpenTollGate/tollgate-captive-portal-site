import { isPrivateRadioIface } from './private-radio';

export const GUEST_SECTIONS = ['tollgate_2g_open', 'tollgate_5g_open'];
const escapeWifi = (value: string) => value.replace(/[\\;,:\"]/g, '\\$&');

/** Fail closed: only installer-owned guest APs, never infer from SSID spelling. */
export function guestWifiPayload(section: string, cfg: Record<string, any>): string {
  const networks = Array.isArray(cfg.network) ? cfg.network : String(cfg.network || '').split(/\s+/).filter(Boolean);
  if (!GUEST_SECTIONS.includes(section) || cfg['.type'] !== 'wifi-iface' ||
      cfg.mode !== 'ap' || cfg.disabled === '1' || !networks.length ||
      isPrivateRadioIface(section, cfg) || networks.some((n: string) => n !== 'lan' && n !== 'guest')) {
    throw new Error('Not a supported guest AP. Private, upstream and ambiguous networks cannot be printed.');
  }
  if (typeof cfg.ssid !== 'string' || !cfg.ssid || new TextEncoder().encode(cfg.ssid).length > 32) {
    throw new Error('Guest SSID must contain 1–32 bytes.');
  }
  if (![undefined, false, true, '0', '1', 0, 1].includes(cfg.hidden)) throw new Error('Invalid hidden-network setting.');
  const hidden = cfg.hidden === true || cfg.hidden === '1' || cfg.hidden === 1;
  let auth: string;
  let password = '';
  if (cfg.encryption === 'none') auth = 'nopass';
  else if (typeof cfg.encryption === 'string' && /^(psk|psk2|psk-mixed)(\+(ccmp|tkip|tkip\+ccmp))?$/.test(cfg.encryption)) {
    auth = 'WPA';
    if (typeof cfg.key !== 'string' || cfg.key.length < 8 || cfg.key.length > 63) throw new Error('Guest passphrase unavailable or unsupported.');
    password = `P:${escapeWifi(cfg.key)};`;
  } else throw new Error('Unsupported guest authentication. WPA3-only, enterprise and WEP are not encoded.');
  return `WIFI:T:${auth};S:${escapeWifi(cfg.ssid)};${password}H:${hidden};;`;
}
