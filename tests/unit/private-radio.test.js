import { describe, it, expect } from 'vitest';
import {
  isPrivateRadioIface,
  PRIVATE_RADIO_SECTION_PREFIX,
  PRIVATE_NETWORK_NAME,
} from '../../admin/src/lib/private-radio';

// The module owns this contract. Its names are declared in
// tollgate-module-basic-go src/cli/operator_settings.go:
//   privateRadio0Section = "wireless.private_radio0"
//   privateRadio1Section = "wireless.private_radio1"
// and packaging/files/etc/uci-defaults/99-tollgate-setup mints the sections
// with network='private' mode='ap'. If the module ever renames a section,
// THIS test is the tripwire: update the constant and the structural net
// together, or the WiFi page silently falls back to raw `uci set` — the
// write the module's applier reverts at the next service start.
describe('isPrivateRadioIface (the module-owned section contract)', () => {
  it('accepts the two section names the module declares', () => {
    expect(isPrivateRadioIface('private_radio0')).toBe(true);
    expect(isPrivateRadioIface('private_radio1')).toBe(true);
    expect(PRIVATE_RADIO_SECTION_PREFIX).toBe('private_radio');
    expect(PRIVATE_NETWORK_NAME).toBe('private');
  });

  it('accepts a renamed section that is structurally a private AP', () => {
    // ubus reports AP mode as 'Master'; a `uci get` fallback reports 'ap'.
    expect(
      isPrivateRadioIface('mgmt_ap', { mode: 'Master', network: ['private'] }),
    ).toBe(true);
    expect(
      isPrivateRadioIface('mgmt_ap', { mode: 'ap', network: ['private'] }),
    ).toBe(true);
  });

  // netifd's `network.wireless status` (the primary real-router path) nests
  // the UCI values under a per-interface `config` table and carries `network`
  // as a plain string. A structural fallback that only read the flat mock
  // shape would be inert exactly where it is supposed to catch a rename.
  it('reads the netifd status shape: config-nested, network as a string', () => {
    expect(
      isPrivateRadioIface('renamed_priv0', {
        section: 'renamed_priv0',
        ifname: 'wlan0-priv',
        config: { mode: 'ap', network: 'private', ssid: 'x' },
      }),
    ).toBe(true);
    expect(
      isPrivateRadioIface('wlan0-priv', {
        config: { mode: 'ap', network: 'lan' },
      }),
    ).toBe(false);
  });

  it('rejects guest radios, non-AP ifaces, and near-miss names', () => {
    expect(isPrivateRadioIface('wlan0', { mode: 'Master', network: ['lan'] })).toBe(false);
    expect(isPrivateRadioIface('default_radio0', { mode: 'ap', network: ['wan'] })).toBe(false);
    expect(isPrivateRadioIface('upstream_sta', { mode: 'sta', network: ['wan'] })).toBe(false);
    // A near-miss name with no structural evidence is NOT private — the
    // prefix alone must not be loosened to substring matching.
    expect(isPrivateRadioIface('priv_radio0')).toBe(false);
  });
});
