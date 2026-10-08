/**
 * Which wifi-iface sections belong to the module's private (management)
 * network — the ones the WiFi page must edit through `tollgate config_set`
 * (`private_ssid`/`private_key`) instead of raw `uci set`. The module's
 * applier converges those sections from config.json at every service start,
 * so a raw UCI edit is silently reverted: a section the board fails to
 * recognize falls back to exactly that broken path, which is why the
 * detection contract is pinned here rather than left as a string prefix at
 * the call site.
 *
 * The contract is the module's, pinned from its source:
 *   - `tollgate-module-basic-go src/cli/operator_settings.go` declares
 *     privateRadio0Section = "wireless.private_radio0" and
 *     privateRadio1Section = "wireless.private_radio1";
 *   - `packaging/files/etc/uci-defaults/99-tollgate-setup` mints the sections
 *     with network='private' and mode='ap'.
 *
 * Detection accepts either signal. The name is the fast path; the structural
 * one (an AP bound to the `private` network) is the safety net for a
 * module-side rename — the exact case a name prefix alone would miss.
 *
 * Two data shapes carry the structural signal, and both are read:
 *   - netifd's `network.wireless status` nests the UCI values under a
 *     per-interface `config` table, with `network` as a plain string;
 *   - the `uci get` fallback in the WiFi page (and the mock in demo/test
 *     mode) builds flat entries with `network` as an array. UCI spells AP
 *     mode 'ap'; the mock's flat entries follow iwinfo's 'Master' — both
 *     count, so the mock cannot lie about which path the board takes.
 */
export const PRIVATE_RADIO_SECTION_PREFIX = 'private_radio';
export const PRIVATE_NETWORK_NAME = 'private';

interface IfaceLike {
  mode?: string;
  network?: string | string[];
  config?: {
    mode?: string;
    network?: string | string[];
  };
}

export function isPrivateRadioIface(section: string, iface?: IfaceLike): boolean {
  if (section.startsWith(PRIVATE_RADIO_SECTION_PREFIX)) {
    return true;
  }
  const cfg = iface?.config || iface;
  const mode = String(cfg?.mode || '').toLowerCase();
  const isAp = mode === 'ap' || mode === 'master';
  if (!isAp) return false;
  const network = cfg?.network;
  const nets =
    typeof network === 'string' ? network.split(/\s+/).filter(Boolean) : network;
  return Array.isArray(nets) && nets.includes(PRIVATE_NETWORK_NAME);
}
