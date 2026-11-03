import { useEffect, useState, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import { navigate } from '../lib/router';

interface ScannedNetwork {
  ssid: string;
  signal: number;
  encryption: string;
  bssid: string;
  radio: string;
  band?: string;
  is_tollgate?: boolean;
  price_per_step?: number;
  step_size?: number;
  is_reseller?: boolean;
  has_internet?: boolean;
  open_network?: boolean;
  mint_url?: string;
  pubkey?: string;
}

interface ConfiguredUpstream {
  ssid: string;
  status: string;
  radio: string;
  encryption: string;
}

interface KnownPeer {
  ssid: string;
  bssid: string;
  best_signal: number;
  price_per_step?: number;
  step_size?: number;
  last_seen: string;
}

interface PeerSession {
  gateway_ip: string;
  interface_name?: string;
  pubkey?: string;
  mint_url?: string;
  metric?: string;
  price_per_step?: number;
  price_unit?: string;
  step_size?: number;
  total_allotment: number;
  total_spent_sats: number;
  usage: number;
  remaining: number;
  status: string;
  bootstrap_phase?: string;
  bootstrap_active?: boolean;
}

function signalQuality(dbm: number): { label: string; color: string } {
  if (dbm >= -50) return { label: 'Excellent', color: 'var(--success)' };
  if (dbm >= -60) return { label: 'Good', color: 'var(--accent)' };
  if (dbm >= -70) return { label: 'Fair', color: 'var(--warning)' };
  return { label: 'Weak', color: 'var(--error)' };
}

function shortMint(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
}

function formatMetric(value: number, metric?: string): string {
  if (!value) return '0';
  if (metric === 'milliseconds') {
    if (value >= 3600000) return `${(value / 3600000).toFixed(1)} h`;
    if (value >= 60000) return `${(value / 60000).toFixed(1)} min`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
    return `${value} ms`;
  }
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

function readNested(obj: any, path: string): any {
  return path.split('.').reduce((cur, part) => (cur == null ? undefined : cur[part]), obj);
}

function privateOrOwn(ssid: string, own: Set<string>): boolean {
  return !ssid || ssid === '(hidden)' || own.has(ssid) || ssid.startsWith('Private-');
}

export default function Peering() {
  const [scanResults, setScanResults] = useState<ScannedNetwork[]>([]);
  const [upstreams, setUpstreams] = useState<ConfiguredUpstream[]>([]);
  const [known, setKnown] = useState<KnownPeer[]>([]);
  const [sessions, setSessions] = useState<PeerSession[]>([]);
  const [config, setConfig] = useState<any>({});
  const [ownSSIDs, setOwnSSIDs] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [connectTarget, setConnectTarget] = useState<ScannedNetwork | null>(null);
  const [connectPass, setConnectPass] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchOwnSSIDs = useCallback(async () => {
    try {
      const data = await ubusCall('network.wireless', 'status');
      const own = new Set<string>();
      Object.values(data || {}).forEach((radio: any) => {
        radio.interfaces?.forEach((iface: any) => {
          const cfg = iface.config || iface;
          if (cfg.ssid) own.add(cfg.ssid);
        });
      });
      setOwnSSIDs(own);
      return own;
    } catch {
      return new Set<string>();
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await ubusCall('tollgate', 'config_get');
      setConfig(data?.data?.config || {});
    } catch {
      setConfig({});
    }
  }, []);

  const fetchUpstreams = useCallback(async () => {
    try {
      const data = await ubusCall('tollgate', 'upstream_list');
      setUpstreams(data?.data || []);
    } catch {
      setUpstreams([]);
    }
  }, []);

  const fetchKnown = useCallback(async () => {
    try {
      const data = await ubusCall('tollgate', 'upstream_known');
      setKnown(data?.data?.known_tollgates || []);
    } catch {
      setKnown([]);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await ubusCall('tollgate', 'upstream_status');
      setSessions(data?.data || []);
    } catch {
      setSessions([]);
    }
  }, []);

  const doScan = useCallback(async () => {
    setScanning(true);
    setError('');
    try {
      const own = ownSSIDs.size ? ownSSIDs : await fetchOwnSSIDs();
      const data = await ubusCall('tollgate', 'upstream_scan');
      if (data?.success) {
        const filtered = (data.data || [])
          .filter((n: ScannedNetwork) => !privateOrOwn(n.ssid, own))
          .sort((a: ScannedNetwork, b: ScannedNetwork) => (b.is_tollgate ? 1 : 0) - (a.is_tollgate ? 1 : 0) || b.signal - a.signal);
        setScanResults(filtered);
      } else {
        setError(data?.error || 'Scan failed');
      }
    } catch (err: any) {
      setError(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [fetchOwnSSIDs, ownSSIDs]);

  useEffect(() => {
    fetchOwnSSIDs();
    fetchConfig();
    fetchUpstreams();
    fetchKnown();
    fetchSessions();
    doScan();
    const timer = setInterval(() => { fetchUpstreams(); fetchSessions(); }, 8000);
    return () => clearInterval(timer);
  }, [fetchOwnSSIDs, fetchConfig, fetchUpstreams, fetchKnown, fetchSessions, doScan]);

  async function doConnect() {
    if (!connectTarget) return;
    setConnecting(true);
    setMsg('');
    setError('');
    try {
      const params: Record<string, string> = { ssid: connectTarget.ssid };
      if (connectPass) params.passphrase = connectPass;
      const data = await ubusCall('tollgate', 'upstream_connect', params);
      if (data?.success) {
        setConnectTarget(null);
        setConnectPass('');
        setMsg(`Peered with ${connectTarget.ssid}`);
        await fetchUpstreams();
        await fetchSessions();
      } else {
        setError(data?.error || 'Connection failed');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function stopPeering() {
    setStopping(true);
    setError('');
    setMsg('');
    try {
      const data = await ubusCall('tollgate', 'upstream_disconnect');
      if (data?.success) {
        setStopConfirm(false);
        setMsg(data.message || 'Stopped peering and fell back to a known upstream');
        await fetchUpstreams();
        await fetchSessions();
      } else {
        setError(data?.error || 'Could not stop peering');
      }
    } catch (err: any) {
      setError(err.message || 'Could not stop peering');
    } finally {
      setStopping(false);
    }
  }

  async function toggleConfig(key: string, value: boolean, label: string) {
    setToggling(key);
    setError('');
    setMsg('');
    try {
      const data = await ubusCall('tollgate', 'config_set', { key, value: value ? 'true' : 'false' });
      if (data?.success) {
        setMsg(`${label} ${value ? 'enabled' : 'disabled'}`);
        await fetchConfig();
      } else {
        setError(data?.error || `Could not update ${label}`);
      }
    } catch (err: any) {
      setError(err.message || `Could not update ${label}`);
    } finally {
      setToggling(null);
    }
  }

  const active = upstreams.find((u) => u.status === 'ACTIVE');
  const activeSession = sessions[0];
  const tollgatePeers = scanResults.filter((n) => n.is_tollgate);
  const otherNetworks = scanResults.filter((n) => !n.is_tollgate);
  const resellerMode = Boolean(readNested(config, 'reseller_mode'));
  const vendorIE = Boolean(readNested(config, 'upstream_wifi.vendor_ie_discovery'));

  function connectButton(net: ScannedNetwork) {
    const isOpen = connectTarget?.bssid === net.bssid && connectTarget?.ssid === net.ssid;
    const encrypted = net.encryption && net.encryption !== 'none' && net.encryption !== 'open';
    if (!isOpen) {
      return (
        <button
          className={net.is_tollgate ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => { setConnectTarget(net); setConnectPass(''); setMsg(''); setError(''); }}
          disabled={scanning || connecting}
        >
          {net.is_tollgate ? 'Peer with this gateway' : 'Use as upstream'}
        </button>
      );
    }
    return (
      <div className="connect-form">
        {encrypted && (
          <input
            type="password"
            className="input"
            placeholder="Password"
            value={connectPass}
            onInput={(e) => setConnectPass((e.target as HTMLInputElement).value)}
            disabled={connecting}
          />
        )}
        <div className="connect-form-row">
          <button className="btn btn-primary btn-sm" onClick={doConnect} disabled={Boolean(connecting || (encrypted && !connectPass))}>
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setConnectTarget(null); setConnectPass(''); }} disabled={connecting}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cobrador Island</h1>
          <p className="text-dim">Operators meet, peer, and stack SATs.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { doScan(); fetchKnown(); }} disabled={scanning}>
          {scanning ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {msg && <p className="success-text">{msg}</p>}
      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Current peer</div>
          {active && <span className="badge badge-success">ACTIVE</span>}
        </div>
        <div className="card-body">
          {!active && <p className="text-dim">No upstream peer. Choose a Cobrador below.</p>}
          {active && (
            <div className="flex flex-col gap-sm">
              <div className="flex items-center gap-sm">
                <span className="scan-item-ssid">{active.ssid}</span>
                <span className="badge badge-muted">{active.radio}</span>
              </div>
              {activeSession && (
                <div className="grid grid-cols-2 gap-sm peer-metrics">
                  <div><span className="stat-label">Spent</span><div className="stat-value">{activeSession.total_spent_sats} sats</div></div>
                  <div><span className="stat-label">Allotment</span><div className="stat-value">{formatMetric(activeSession.total_allotment, activeSession.metric)}</div></div>
                  <div><span className="stat-label">Used</span><div className="stat-value">{formatMetric(activeSession.usage, activeSession.metric)}</div></div>
                  <div><span className="stat-label">Remaining</span><div className="stat-value">{formatMetric(activeSession.remaining, activeSession.metric)}</div></div>
                  <div><span className="stat-label">Price</span><div className="stat-value">{activeSession.price_per_step || '?'} {activeSession.price_unit || 'sat'} / step</div></div>
                  <div><span className="stat-label">Mint</span><div className="stat-value">{shortMint(activeSession.mint_url) || 'unknown'}</div></div>
                  <div><span className="stat-label">Session</span><div className="stat-value">{activeSession.status}{activeSession.bootstrap_active ? ` · ${activeSession.bootstrap_phase}` : ''}</div></div>
                  <div><span className="stat-label">Peer key</span><div className="stat-value text-mono">{activeSession.pubkey ? `${activeSession.pubkey.slice(0, 12)}…` : 'unknown'}</div></div>
                </div>
              )}
              <div className="flex gap-sm">
                {!stopConfirm && (
                  <button className="btn btn-danger btn-sm" onClick={() => setStopConfirm(true)} disabled={stopping}>
                    Stop peering
                  </button>
                )}
                {stopConfirm && (
                  <div className="remove-confirm-inline">
                    <span className="text-dim">Stop peering and fall back to the best known non-TollGate upstream. If none works, this peer stays active.</span>
                    <div className="flex gap-xs">
                      <button className="btn btn-danger btn-sm" onClick={stopPeering} disabled={stopping}>
                        {stopping ? 'Stopping...' : 'Stop and fall back'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setStopConfirm(false)} disabled={stopping}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Discovery and SAT stacking</div></div>
        <div className="card-body flex flex-col gap-sm">
          <label className="toggle-row">
            <input type="checkbox" checked={vendorIE} disabled={toggling === 'upstream_wifi.vendor_ie_discovery'}
              onChange={(e) => toggleConfig('upstream_wifi.vendor_ie_discovery', (e.target as HTMLInputElement).checked, 'TollGate peer discovery')} />
            <span>
              <strong>Discover TollGate peers</strong>
              <span className="text-dim">Read the 802.11 vendor element that Cobrador gateways advertise.</span>
            </span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={resellerMode} disabled={toggling === 'reseller_mode'}
              onChange={(e) => toggleConfig('reseller_mode', (e.target as HTMLInputElement).checked, 'SAT stacking')} />
            <span>
              <strong>Buy upstream access for sats</strong>
              <span className="text-dim">This router pays the selected peer and resells access to your customers.</span>
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Nearby Cobradors</div>
          <span className="badge badge-muted">{tollgatePeers.length}</span>
        </div>
        <div className="card-body">
          {scanning && <p className="text-dim">Scanning for TollGate peers...</p>}
          {!scanning && tollgatePeers.length === 0 && (
            <p className="text-dim">No Cobrador peers nearby. Move closer to another operator or enable discovery.</p>
          )}
          {tollgatePeers.map((net) => {
            const sq = signalQuality(net.signal);
            return (
              <div key={net.bssid + net.radio} className="peer-row peer-item">
                <div className="peer-main">
                  <div className="peer-title">
                    <span className="scan-item-ssid">{net.ssid}</span>
                    <span className="badge badge-success">TollGate</span>
                    {net.is_reseller && <span className="badge badge-muted">Reseller</span>}
                    {net.has_internet === false && <span className="badge badge-muted">No internet?</span>}
                  </div>
                  <div className="peer-sub">
                    <span className="signal-strength" style={{ color: sq.color }}><span className="signal-dot" style={{ background: sq.color }} />{sq.label}</span>
                    <span>{net.price_per_step ? `${net.price_per_step} sat / step` : 'price via signed ad'}</span>
                    <span>{net.mint_url ? shortMint(net.mint_url) : 'mint via signed ad'}</span>
                  </div>
                </div>
                <div className="peer-action">{connectButton(net)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Other upstream WiFi</div></div>
        <div className="card-body">
          {!scanning && otherNetworks.length === 0 && <p className="text-dim">No other upstream networks found.</p>}
          {otherNetworks.map((net) => {
            const sq = signalQuality(net.signal);
            return (
              <div key={net.bssid + net.radio} className="peer-row">
                <div className="peer-main">
                  <div className="peer-title"><span className="scan-item-ssid">{net.ssid}</span>
                    <span className="badge badge-muted">{net.encryption === 'none' ? 'Open' : net.encryption}</span>
                  </div>
                  <div className="peer-sub">
                    <span className="signal-strength" style={{ color: sq.color }}><span className="signal-dot" style={{ background: sq.color }} />{sq.label}</span>
                    <span className="text-dim text-mono">{net.radio}</span>
                  </div>
                </div>
                <div className="peer-action">{connectButton(net)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Known peers</div></div>
        <div className="card-body">
          {known.length === 0 && <p className="text-dim">No peer history yet. Enable discovery and rescan.</p>}
          {known.slice().sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen))).slice(0, 8).map((peer) => (
            <div key={peer.bssid + peer.ssid} className="peer-row">
              <div className="peer-main">
                <div className="peer-title"><span className="scan-item-ssid">{peer.ssid}</span>
                  <span className="badge badge-muted">{peer.best_signal} dBm best</span>
                </div>
                <div className="peer-sub">
                  {peer.price_per_step ? <span>{peer.price_per_step} sat / step</span> : null}
                  <span>{peer.last_seen ? new Date(peer.last_seen).toLocaleString() : ''}</span>
                </div>
              </div>
              <div className="peer-action">
                <button className="btn btn-secondary btn-sm" onClick={() => {
                  setConnectTarget({ ssid: peer.ssid, signal: peer.best_signal, encryption: 'none', bssid: peer.bssid, radio: 'radio0', is_tollgate: true });
                  setConnectPass('');
                }}>Peer again</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
