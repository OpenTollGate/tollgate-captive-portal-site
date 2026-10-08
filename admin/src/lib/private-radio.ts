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
 * module-side rename — the exact case a name prefix alone would miss. ubus
 * reports AP mode as 'Master' while a `uci get` fallback reports 'ap', so
 * both spellings count.
 */
export const PRIVATE_RADIO_SECTION_PREFIX = 'private_radio';
export const PRIVATE_NETWORK_NAME = 'private';

export function isPrivateRadioIface(
  section: string,
  iface?: { mode?: string; network?: string[] },
): boolean {
  if (typeof section === 'string' && section.startsWith(PRIVATE_RADIO_SECTION_PREFIX)) {
    return true;
  }
  const mode = (iface?.mode || '').toLowerCase();
  const isAp = mode === 'ap' || mode === 'master';
  return (
    isAp &&
    Array.isArray(iface?.network) &&
    iface.network.includes(PRIVATE_NETWORK_NAME)
  );
}
