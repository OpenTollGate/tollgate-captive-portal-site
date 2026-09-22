/**
 * Mock ubus layer for demo deployments.
 * Activated when VITE_MOCK=true.
 *
 * Returns data matching tollgate --json CLI response shapes.
 */
import { BRAND } from '../brand';

const MOCK_SESSION = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

const now = () => Math.floor(Date.now() / 1000);

const board = {
  hostname: `${BRAND.id}-gw1`,
  model: 'GL.iNet GL-MT3000',
  kernel: '5.15.134',
  system: 'MediaTek MT7981B',
  release: {
    distribution: 'OpenWrt',
    version: '23.05.2',
    revision: 'r23630-842932a63d',
    target: 'mediatek/filogic',
    description: 'OpenWrt 23.05.2 r23630-842932a63d',
  },
};

function info() {
  const uptime = 3 * 86400 + 7 * 3600 + 42 * 60 + 13;
  return {
    uptime,
    localtime: now(),
    memory: {
      total: 512 * 1048576,
      free: 200 * 1048576,
      buffered: 32 * 1048576,
      shared: 4 * 1048576,
    },
  };
}

const interfaceDump = {
  interface: [
    {
      interface: 'lan',
      up: true,
      proto: 'static',
      'ipv4-address': [{ address: '192.168.1.1', mask: 24 }],
      route: [{ target: '0.0.0.0', mask: 0, nexthop: '192.168.1.1' }],
      'dns-server': ['192.168.1.1'],
    },
    {
      interface: 'wan',
      up: true,
      proto: 'dhcp',
      'ipv4-address': [{ address: '192.168.1.142', mask: 24 }],
      route: [{ target: '0.0.0.0', mask: 0, nexthop: '192.168.1.1' }],
      'dns-server': ['1.1.1.1', '8.8.8.8'],
    },
  ],
};

const wirelessStatus = {
  radio0: {
    up: true,
    config: { channel: 6, hwmode: '11g', htmode: 'HT40', country: 'NO' },
    interfaces: [
      { ifname: 'wlan0', ssid: BRAND.id, encryption: 'psk2', hidden: false, mode: 'Master', network: ['lan'] },
    ],
  },
  radio1: {
    up: true,
    config: { channel: 36, hwmode: '11a', htmode: 'VHT80', country: 'NO' },
    interfaces: [
      { ifname: 'wlan1', ssid: `${BRAND.id}-5g`, encryption: 'psk2', hidden: false, mode: 'Master', network: ['lan'] },
    ],
  },
};

const dhcpLeases = {
  device: {
    br_lan: {
      leases: [
        { hostname: 'iPhone-15-Pro', ipaddr: '192.168.1.101', macaddr: 'A4:83:E7:2B:1F:3A', expires: 43200 },
        { hostname: 'MacBook-Air', ipaddr: '192.168.1.102', macaddr: '3C:22:FB:9D:44:17', expires: 43180 },
        { hostname: 'Galaxy-S24', ipaddr: '192.168.1.103', macaddr: 'D8:6B:D7:11:AE:5C', expires: 42960 },
        { hostname: 'Nest-Thermostat', ipaddr: '192.168.1.105', macaddr: '18:B4:30:AA:CC:22', expires: 41500 },
      ],
    },
  },
};

const mockConfigSchema = {
  success: true,
  message: 'Configuration schema',
  data: {
    config: [
      { name: 'LogLevel', json_key: 'log_level', type: 'string', description: 'Logging verbosity', default: 'info', required: true, editable: true, enum: ['debug', 'info', 'warn', 'error'] },
      { name: 'Metric', json_key: 'metric', type: 'string', description: 'Metering metric type', default: 'bytes', required: true, editable: true, enum: ['bytes', 'milliseconds'] },
      { name: 'StepSize', json_key: 'step_size', type: 'uint64', description: 'Step size', default: 22020096, required: true, editable: true },
      { name: 'Margin', json_key: 'margin', type: 'float64', description: 'Margin factor (0.0-1.0)', default: 0.1, required: false, editable: true, min: 0, max: 1 },
      { name: 'ShowSetup', json_key: 'show_setup', type: 'bool', description: 'Show setup wizard', default: true, required: true, editable: true },
      { name: 'ResellerMode', json_key: 'reseller_mode', type: 'bool', description: 'Enable reseller mode', default: false, required: true, editable: true },
      { name: 'AcceptedMints', json_key: 'accepted_mints', type: 'array', description: 'Accepted Cashu mints', required: true, editable: true, children: [
        { name: 'URL', json_key: 'url', type: 'string', description: 'Mint URL', required: true, editable: true },
        { name: 'PricePerStep', json_key: 'price_per_step', type: 'uint64', description: 'Price per step in sats', default: 1, required: true, editable: true },
        { name: 'MinBalance', json_key: 'min_balance', type: 'uint64', description: 'Minimum balance (sats)', default: 64, required: true, editable: true },
      ]},
      { name: 'ProfitShare', json_key: 'profit_share', type: 'array', description: 'Profit sharing config', required: true, editable: true, children: [
        { name: 'Factor', json_key: 'factor', type: 'float64', description: 'Share ratio (0.0-1.0)', required: true, editable: true, min: 0, max: 1 },
        { name: 'Identity', json_key: 'identity', type: 'string', description: 'Identity name', required: true, editable: true },
      ]},
    ],
    identities: [],
  },
};

const mockConfigGet = {
  success: true,
  message: 'Configuration retrieved',
  data: {
    config: {
      config_version: 'v0.0.7',
      log_level: 'info',
      metric: 'bytes',
      step_size: 22020096,
      margin: 0.1,
      show_setup: true,
      reseller_mode: false,
      accepted_mints: [
        { url: 'https://testnut-compat.mints.orangesync.tech', min_balance: 64, balance_tolerance_percent: 10, payout_interval_seconds: 60, min_payout_amount: 128, price_per_step: 1, price_unit: 'sats', purchase_min_steps: 0 },
      ],
      profit_share: [
        { factor: 0.8, identity: 'operator' },
        { factor: 0.2, identity: 'treasury' },
      ],
      upstream_detector: {
        probe_timeout: '10s',
        probe_retry_count: 3,
        probe_retry_delay: '2s',
        require_valid_signature: true,
        ignore_interfaces: ['lo', 'docker0', 'br-lan', 'hostap0'],
      },
      upstream_wifi: {
        enabled: false,
        ssid: '',
        passphrase: '',
        encryption: 'none',
        radio: '',
        manual_pause_seconds: 120,
      },
    },
    identities: {
      identities: [
        { name: 'operator', nsec: 'nsec1...', pubkey: 'npub1...' },
        { name: 'treasury', nsec: 'nsec1...', pubkey: 'npub1...' },
      ],
    },
  },
};

const mockWalletBalance = {
  success: true,
  message: 'Total wallet balance: 14250 sats',
  data: { balance: 14250 },
};

const mockWalletInfo = {
  success: true,
  message: 'Wallet info - Total: 14250 sats across 1 mints',
  data: {
    total_balance: 14250,
    mint_count: 1,
    mint_balances: { 'https://testnut-compat.mints.orangesync.tech': 14250 },
  },
};

const mockStatus = {
  success: true,
  message: 'Service status retrieved',
  data: {
    running: true,
    version: { version: '0.7.0-dev', commit: 'abc1234', build_date: '2025-01-15' },
    uptime: '72h15m30s',
    config_ok: true,
    wallet_ok: true,
    network_ok: true,
  },
};

const mockHealth = {
  success: true,
  message: 'healthy',
  data: {
    status: 'ok',
    version: '0.7.0-dev',
    config_ok: true,
    wallet_ok: true,
    uptime: '72h15m30s',
  },
};

export function mockUbusCall(
  obj: string,
  method: string,
  _params: Record<string, any> = {}
): Promise<any> {
  const key = `${obj}.${method}`;

  const handlers: Record<string, () => any> = {
    'session.access': () => ({ access: true }),
    'system.board': () => board,
    'system.info': () => info(),
    'system.password_set': () => ({}),
    'network.interface.dump': () => interfaceDump,
    // rpcd exposes the wireless object under the `network.` namespace (see
    // openwrt/rpcd/tollgate_acl.json: "network.wireless": ["status","reload"]).
    // The admin WiFi page calls it that way; keep the short aliases too.
    'network.wireless.status': () => wirelessStatus,
    'network.wireless.reload': () => ({}),
    'wireless.status': () => wirelessStatus,
    'wireless.reload': () => ({}),
    'dhcp.ipv4leases': () => dhcpLeases,
    'uci.get': () => {
      if (_params?.config === 'tollgate' && _params?.section === 'lnurl') {
        return { value: { lnurl: `lnurlp://pay.${BRAND.id}.com/.well-known/lnurlp/root` } };
      }
      return {};
    },
    'uci.set': () => ({}),
    'uci.commit': () => ({}),

    // tollgate --json methods
    'tollgate.config_schema': () => mockConfigSchema,
    'tollgate.config_get': () => mockConfigGet,
    'tollgate.config_set': () => ({
      success: true,
      message: `Set ${_params.key} = ${_params.value} (restart tollgate-wrt to apply)`,
      data: { key: _params.key, value: _params.value },
    }),
    'tollgate.config_save': () => ({ success: true, message: 'Configuration saved (restart tollgate-wrt to apply)' }),
    'tollgate.config_save_identities': () => ({ success: true, message: 'Identities saved (restart tollgate-wrt to apply)' }),
    'tollgate.wallet_balance': () => mockWalletBalance,
    'tollgate.wallet_info': () => mockWalletInfo,
    'tollgate.wallet_fund': () => ({
      success: true,
      message: `Successfully funded wallet with ${_params.amount || 100} sats`,
      data: { amount_received: _params.amount || 100 },
    }),
    'tollgate.wallet_drain_cashu': () => ({
      success: true,
      message: 'Successfully drained 14250 sats from 1 mints',
      data: {
        success: true,
        tokens: [{ mint_url: 'https://testnut-compat.mints.orangesync.tech', balance_sats: 14250, token: 'cashuAeyJ0b2tlbiI6Im1vY2sifQ' }],
        total_sats: 14250,
      },
    }),
    'tollgate.status': () => mockStatus,
    'tollgate.health': () => mockHealth,
    'tollgate.upstream_scan': () => ({
      success: true,
      message: 'Found 3 network(s)',
      data: [
        { ssid: 'UpstreamWiFi', signal: -45, encryption: 'WPA2', bssid: 'AA:BB:CC:DD:EE:FF', radio: 'radio0' },
        { ssid: 'NeighborNet', signal: -72, encryption: 'WPA2', bssid: '11:22:33:44:55:66', radio: 'radio0' },
        { ssid: 'OpenNet', signal: -80, encryption: 'none', bssid: '77:88:99:AA:BB:CC', radio: 'radio1' },
      ],
    }),
    'tollgate.upstream_connect': () => ({ success: true, message: `Connected to '${_params.ssid}'` }),
    'tollgate.upstream_list': () => ({
      success: true,
      message: '1 upstream STA(s) configured',
      data: [{ ssid: 'UpstreamWiFi', status: 'ACTIVE', radio: 'radio0', encryption: 'WPA2' }],
    }),
    'tollgate.upstream_remove': () => ({ success: true, message: `Removed upstream '${_params.ssid}'` }),
  };

  const handler = handlers[key];
  if (!handler) {
    return Promise.reject(new Error(`mock: unknown call ${key}`));
  }

  return Promise.resolve(handler());
}

export function mockLogin(username: string, _password: string): Promise<any> {
  return Promise.resolve({
    ubus_rpc_session: MOCK_SESSION,
    username,
    expires: 3600,
  });
}

export function mockSessionId(): string {
  return MOCK_SESSION;
}
