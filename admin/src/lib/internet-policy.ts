export type UplinkHealth = 'online' | 'offline' | 'checking' | 'unavailable';
export interface UplinkState {
  interface: string;
  linkUp: boolean | undefined;
  health: UplinkHealth;
  reason: string;
}
export interface PolicyFamily {
  active: string;
  primary: UplinkState;
  backup: UplinkState;
  backupSupported?: boolean;
}
export interface InternetPolicy {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  policy: string;
  checkMethod: string;
  issue: string;
  ipv4: PolicyFamily;
  ipv6: PolicyFamily;
}

function uplink(value: any, expected: string): UplinkState {
  const health = ['online', 'offline', 'checking'].includes(value?.health) ? value.health : 'unavailable';
  return {
    interface: expected,
    linkUp: typeof value?.link_up === 'boolean' ? value.link_up : undefined,
    health,
    reason: typeof value?.reason === 'string' ? value.reason : '',
  };
}

export function parseInternetPolicy(value: any): InternetPolicy | null {
  if (value?.success !== true || typeof value.enabled !== 'boolean') return null;
  function family(raw: any, primary: string, backup: string): PolicyFamily {
    return {
      active: [primary, backup, 'none'].includes(raw?.active) ? raw.active : 'unknown',
      primary: uplink(raw?.primary, primary),
      backup: uplink(raw?.backup, backup),
      backupSupported: typeof raw?.backup_supported === 'boolean' ? raw.backup_supported : undefined,
    };
  }
  return {
    supported: value.supported === true,
    enabled: value.enabled,
    running: value.controller_running === true,
    policy: typeof value.policy === 'string' ? value.policy : '',
    checkMethod: typeof value.check_method === 'string' ? value.check_method : '',
    issue: typeof value.error === 'string' ? value.error.trim().slice(0, 500) : '',
    ipv4: family(value.ipv4, 'wan', 'wwan'),
    ipv6: family(value.ipv6, 'wan6', 'wwan6'),
  };
}

export function activeUplink(policy: InternetPolicy, family: PolicyFamily): string {
  return policy.enabled && policy.supported && policy.running && policy.policy === 'ethernet-first'
    ? family.active : 'unknown';
}

export function activeLabel(active: string): string {
  return active === 'wan' || active === 'wan6' ? 'Ethernet WAN'
    : active === 'wwan' || active === 'wwan6' ? 'Venue Wi-Fi'
    : active === 'none' ? 'No healthy uplink' : 'Not confirmed';
}

export function healthLabel(state: UplinkState, policy: InternetPolicy): string {
  if (!policy.enabled) return 'Checks off';
  if (!policy.running || policy.checkMethod !== 'bound-dns-http') return 'Unavailable';
  if (state.reason === 'ipv6-backup-unsupported') return 'Uses IPv4 backup';
  if (state.linkUp === false) return 'Not connected';
  if (state.health === 'checking') return 'Checking';
  if (state.health === 'unavailable') return 'Unavailable';
  if (state.health === 'online') return state.linkUp === true ? 'Ready' : 'Link state unknown';
  if (state.reason === 'no-dns') return 'DNS check failed';
  if (['captive-or-blocked', 'captive', 'blocked'].includes(state.reason)) return 'Sign-in or blocked response';
  if (state.reason === 'not-configured') return 'Not configured';
  return 'Internet check failed';
}

/** This describes the applied policy, never the main routing table alone. */
export function policySource(policy: InternetPolicy, ssid: string): { source: string; activeInterface?: string } {
  const v4 = activeUplink(policy, policy.ipv4);
  const v6 = activeUplink(policy, policy.ipv6);
  if (v4 === 'unknown' || v6 === 'unknown') return { source: 'Source not confirmed' };
  if (v4 === 'none' && v6 === 'none') return { source: 'No healthy uplink' };
  const kind = (name: string) => name === 'none' ? '' : name.startsWith('wwan') ? 'wifi' : 'ethernet';
  if (kind(v4) && kind(v6) && kind(v4) !== kind(v6)) return { source: 'Multiple uplinks · IPv4 and IPv6 differ' };
  const active = v4 === 'none' ? v6 : v4;
  const source = kind(active) === 'wifi' ? `Wi-Fi${ssid ? ` · ${ssid}` : ''}` : 'Ethernet';
  return { source: `${source}${v4 === 'none' ? ' (IPv6)' : v6 === 'none' ? ' (IPv4)' : ''}`, activeInterface: active };
}
