import { useState, useEffect, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';

interface WifiIface {
  ifname: string;
  ssid: string;
  encryption: string;
  hidden: boolean;
  mode: string;
  network: string[];
  config?: WifiIface;
  section?: string;
}

interface WifiRadio {
  up: boolean;
  config: {
    channel: number;
    hwmode: string;
    htmode: string;
    country?: string;
  };
  interfaces: WifiIface[];
}

interface ScannedNetwork {
  ssid: string;
  signal: number;
  encryption: string;
  bssid: string;
  radio: string;
  channel: string;
}

interface ConfiguredUpstream {
  ssid: string;
  status: string;
  radio: string;
  encryption: string;
}

function signalQuality(dbm: number): { label: string; color: string } {
  if (dbm >= -50) return { label: 'Excellent', color: 'var(--success)' };
  if (dbm >= -60) return { label: 'Good', color: '#4da6ff' };
  if (dbm >= -70) return { label: 'Fair', color: '#e88a3a' };
  return { label: 'Weak', color: 'var(--error)' };
}

function shortEncryption(enc: string): string {
  if (!enc || enc === 'none') return 'Open';
  if (enc.includes('WPA3')) return 'WPA3';
  if (enc.includes('WPA2') && enc.includes('WPA3')) return 'WPA2/3';
  if (enc.includes('WPA2')) return 'WPA2';
  if (enc.includes('WPA')) return 'WPA';
  return enc.length > 10 ? enc.substring(0, 10) : enc;
}

export default function Wifi() {
  const [radios, setRadios] = useState<Record<string, WifiRadio>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editSsid, setEditSsid] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [scanResults, setScanResults] = useState<ScannedNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  const [upstreams, setUpstreams] = useState<ConfiguredUpstream[]>([]);

  const [connectTarget, setConnectTarget] = useState<ScannedNetwork | null>(null);
  const [connectPass, setConnectPass] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const [upstreamMsg, setUpstreamMsg] = useState('');

  function getOwnSSIDs(): Set<string> {
    const ssids = new Set<string>();
    Object.values(radios).forEach((r) => {
      r.interfaces?.forEach((i) => {
        const cfg = i.config || i;
        if (cfg.ssid) ssids.add(cfg.ssid);
      });
    });
    return ssids;
  }

  const fetchStatus = useCallback(async () => {
    try {
      let data = null;
      try {
        data = await ubusCall('network.wireless', 'status');
      } catch {
        const uciData = await ubusCall('uci', 'get', { config: 'wireless' });
        if (uciData?.values) {
          const radios: Record<string, any> = {};
          const ifaces = [];
          for (const [name, section] of Object.entries(uciData.values)) {
            const s = section as any;
            if (s['.type'] === 'wifi-device') {
              radios[name] = {
                up: s.disabled !== '1',
                config: {
                  channel: parseInt(s.channel) || 0,
                  hwmode: s.hwmode || '',
                  htmode: s.htmode || '',
                  country: s.country,
                },
                interfaces: [],
              };
            } else if (s['.type'] === 'wifi-iface') {
              ifaces.push({
                section: name,
                radio: s.device || '',
                ifname: s.ifname || name,
                ssid: s.ssid || '',
                encryption: s.encryption || 'none',
                hidden: s.hidden === '1',
                mode: s.mode || 'ap',
                network: (s.network || '').split(' '),
              });
            }
          }
          for (const iface of ifaces) {
            if (radios[iface.radio]) {
              radios[iface.radio].interfaces.push(iface);
            }
          }
          data = radios;
        }
      }
      setRadios(data || {});
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load WiFi status');
    } finally {
      setLoading(false);
    }
  }, []);

  async function fetchUpstreams() {
    try {
      const data = await ubusCall('tollgate', 'upstream_list');
      setUpstreams(data?.data || []);
    } catch {
      setUpstreams([]);
    }
  }

  async function doScan() {
    setScanning(true);
    setScanError('');
    try {
      const data = await ubusCall('tollgate', 'upstream_scan');
      if (data?.success) {
        const ownSSIDs = getOwnSSIDs();
        const filtered = (data.data || [])
          .filter(
            (n: ScannedNetwork) =>
              n.ssid !== '(hidden)' && !ownSSIDs.has(n.ssid)
          )
          .sort((a: ScannedNetwork, b: ScannedNetwork) => b.signal - a.signal);
        setScanResults(filtered);
      } else {
        setScanError(data?.error || 'Scan failed');
      }
    } catch (err: any) {
      setScanError(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function doConnect() {
    if (!connectTarget) return;
    setConnecting(true);
    setUpstreamMsg('');
    try {
      const params: Record<string, string> = { ssid: connectTarget.ssid };
      if (connectPass) params.passphrase = connectPass;
      const data = await ubusCall('tollgate', 'upstream_connect', params);
      if (data?.success) {
        setConnectTarget(null);
        setConnectPass('');
        setUpstreamMsg('connected');
        fetchUpstreams();
        setTimeout(() => setUpstreamMsg(''), 3000);
      } else {
        setUpstreamMsg(data?.error || 'Connection failed');
      }
    } catch (err: any) {
      setUpstreamMsg(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function doRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setUpstreamMsg('');
    try {
      const data = await ubusCall('tollgate', 'upstream_remove', {
        ssid: removeTarget,
      });
      if (data?.success) {
        setRemoveTarget(null);
        setUpstreamMsg('removed');
        fetchUpstreams();
        setTimeout(() => setUpstreamMsg(''), 3000);
      } else {
        setUpstreamMsg(data?.error || 'Remove failed');
      }
    } catch (err: any) {
      setUpstreamMsg(err.message || 'Remove failed');
    } finally {
      setRemoving(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    fetchUpstreams();
    doScan();
  }, [fetchStatus]);

  function startEdit(ifname: string, ssid: string) {
    setEditSsid(ifname);
    setEditName(ssid);
    setEditPassword('');
    setSaveMsg('');
  }

  async function saveEdit() {
    if (!editSsid) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await ubusCall('uci', 'set', {
        config: 'wireless',
        section: editSsid,
        values: { ssid: editName },
      });
      if (editPassword) {
        await ubusCall('uci', 'set', {
          config: 'wireless',
          section: editSsid,
          values: { key: editPassword },
        });
      }
      await ubusCall('uci', 'commit', { config: 'wireless' });
      try {
        await ubusCall('network.wireless', 'reload');
      } catch {
        try {
          await ubusCall('file', 'exec', { command: 'wifi', params: ['reload'] });
        } catch {}
      }

      setSaveMsg('saved');
      setEditSsid(null);
      setTimeout(() => fetchStatus(), 2000);
    } catch (err: any) {
      setSaveMsg(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner loading-spinner-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-page flex-col gap-sm">
        <p className="error-text">{error}</p>
        <button className="btn btn-secondary btn-sm" onClick={fetchStatus}>
          Retry
        </button>
      </div>
    );
  }

  const radioEntries = Object.entries(radios);

  return (
    <div className="flex flex-col gap-md">
      <div
        className="flex items-center justify-between animate-in"
        style={{ marginBottom: '-0.3rem' }}
      >
        <h2
          style={{
            fontSize: 'var(--font-size-large)',
            fontWeight: 700,
          }}
        >
          WiFi
        </h2>
        <button className="btn btn-secondary btn-sm" onClick={fetchStatus}>
          Refresh
        </button>
      </div>

      {radioEntries.length === 0 && (
        <div className="card animate-in-delay-1">
          <p className="text-dim" style={{ fontSize: 'var(--font-size-small)' }}>
            No wireless radios found
          </p>
        </div>
      )}

      {radioEntries.map(([radioName, radio], ri) => (
        <div key={radioName} className={`card animate-in-delay-${ri + 1}`}>
          <div className="card-header">
            <div className="card-title">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={radio.up ? 'var(--success)' : 'var(--error)'}
                stroke-width="2"
              >
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <circle cx="12" cy="20" r="1" fill={radio.up ? 'var(--success)' : 'var(--error)'} />
              </svg>
              {radioName}
            </div>
            <span className={`badge ${radio.up ? 'badge-success' : 'badge-error'}`}>
              {radio.up ? 'Up' : 'Down'}
            </span>
          </div>

          <div className="card-body">
            <div className="stat-row">
              <span className="stat-label">Channel</span>
              <span className="stat-value">{radio.config?.channel || '—'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Mode</span>
              <span className="stat-value">{radio.config?.htmode || '—'}</span>
            </div>

            {radio.interfaces?.map((iface) => {
              const cfg = iface.config || iface;
              const section = iface.section || iface.ifname;
              const ssid = cfg.ssid;
              const mode = cfg.mode;
              const encryption = cfg.encryption;
              const hidden = cfg.hidden;
              const network = cfg.network;
              return (
              <div key={section} style={{ marginTop: '0.75rem' }}>
                <hr className="divider" />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 'var(--font-size-small)',
                    }}
                  >
                    {ssid || iface.ifname}
                  </span>
                  <span className="badge badge-accent">{mode}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Interface</span>
                  <span className="stat-value text-mono">{iface.ifname}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Encryption</span>
                  <span className="stat-value">
                    {encryption || 'None'}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Hidden</span>
                  <span className="stat-value">{hidden ? 'Yes' : 'No'}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Network</span>
                  <span className="stat-value">
                    {network?.join(', ') || '—'}
                  </span>
                </div>

                {editSsid === section ? (
                  <div
                    className="flex flex-col gap-sm"
                    style={{ marginTop: '0.75rem' }}
                  >
                    <div className="input-group">
                      <label className="input-label">SSID Name</label>
                      <input
                        type="text"
                        className="input"
                        value={editName}
                        onInput={(e) =>
                          setEditName((e.target as HTMLInputElement).value)
                        }
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Password</label>
                      <input
                        type="password"
                        className="input"
                        value={editPassword}
                        onInput={(e) =>
                          setEditPassword((e.target as HTMLInputElement).value)
                        }
                        placeholder="Leave blank to keep current"
                      />
                    </div>
                    <div className="flex gap-sm">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={saveEdit}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditSsid(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    {saveMsg && saveMsg !== 'saved' && (
                      <p className="error-text">{saveMsg}</p>
                    )}
                    {saveMsg === 'saved' && (
                      <p className="success-text">Changes applied</p>
                    )}
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: '0.6rem' }}
                    onClick={() => startEdit(section, ssid)}
                  >
                    Edit
                  </button>
                )}
              </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Connected Upstream ────────────────────────────────── */}

      <div className="card animate-in-delay-3">
        <div className="card-header">
          <div className="card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <circle cx="12" cy="20" r="1" fill="var(--accent)" />
            </svg>
            Connected Upstream
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { fetchUpstreams(); doScan(); }}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
        <div className="card-body">
          {upstreams.length === 0 && (
            <p className="text-dim" style={{ fontSize: 'var(--font-size-small)' }}>
              No upstream configured
            </p>
          )}

          {upstreams.map((up) => (
            <div key={up.ssid} className="upstream-item">
              <div className="scan-item-info">
                <span className="scan-item-ssid">{up.ssid}</span>
                <span className={`badge ${up.status === 'ACTIVE' ? 'badge-success' : 'badge-muted'}`}>
                  {up.status}
                </span>
              </div>
              <div className="scan-item-meta">
                <span className="text-dim text-mono">{up.radio}</span>
                {removeTarget === up.ssid ? (
                  <div className="remove-confirm-inline">
                    <span className="text-dim" style={{ fontSize: 'var(--font-size-xsmall)' }}>
                      {up.status === 'ACTIVE'
                        ? 'This will disconnect your internet.'
                        : `Remove ${up.ssid}?`}
                    </span>
                    <div className="flex gap-xs">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={doRemove}
                        disabled={removing}
                      >
                        {removing ? 'Removing...' : 'Remove'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setRemoveTarget(null)}
                        disabled={removing}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setRemoveTarget(up.ssid)}
                    disabled={scanning || connecting}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}

          {upstreamMsg && upstreamMsg !== 'connected' && upstreamMsg !== 'removed' && (
            <p className="error-text" style={{ marginTop: '0.5rem' }}>{upstreamMsg}</p>
          )}
          {upstreamMsg === 'connected' && (
            <p className="success-text" style={{ marginTop: '0.5rem' }}>Connected successfully</p>
          )}
          {upstreamMsg === 'removed' && (
            <p className="success-text" style={{ marginTop: '0.5rem' }}>Upstream removed</p>
          )}
        </div>
      </div>

      {/* ── Available Networks (scan results) ─────────────────── */}

      <div className="card animate-in-delay-4">
        <div className="card-header">
          <div className="card-title">Available Networks</div>
        </div>
        <div className="card-body">
          {scanning && (
            <div className="flex items-center justify-center gap-sm" style={{ padding: '1.5rem 0' }}>
              <div className="loading-spinner" />
              <span className="text-dim">Scanning...</span>
            </div>
          )}

          {scanError && !scanning && (
            <div className="flex flex-col gap-sm">
              <p className="error-text">{scanError}</p>
              <button className="btn btn-secondary btn-sm" onClick={doScan} style={{ alignSelf: 'flex-start' }}>
                Retry Scan
              </button>
            </div>
          )}

          {!scanning && !scanError && scanResults.length === 0 && (
            <p className="text-dim" style={{ fontSize: 'var(--font-size-small)' }}>
              No networks found
            </p>
          )}

          {!scanning && scanResults.map((net) => {
            const sq = signalQuality(net.signal);
            const isEnc = net.encryption && net.encryption !== 'none';
            const isOpen = connectTarget?.bssid === net.bssid;

            return (
              <div key={net.bssid + net.radio} className="scan-item">
                <div className="scan-item-info">
                  <span className="scan-item-ssid">{net.ssid}</span>
                  <span className="signal-strength" style={{ color: sq.color }}>
                    <span className="signal-dot" style={{ background: sq.color }} />
                    {sq.label}
                  </span>
                  <span className="badge badge-muted">{shortEncryption(net.encryption)}</span>
                </div>

                <div className="scan-item-meta">
                  <span className="text-dim text-mono">{net.radio}</span>

                  {isOpen ? (
                    <div className="connect-form">
                      {isEnc && (
                        <input
                          type="password"
                          className="input"
                          placeholder="Password"
                          value={connectPass}
                          onInput={(e) =>
                            setConnectPass((e.target as HTMLInputElement).value)
                          }
                          disabled={connecting}
                        />
                      )}
                      <div className="connect-form-row">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={doConnect}
                          disabled={Boolean(connecting || (isEnc && !connectPass))}
                        >
                          {connecting ? 'Connecting...' : 'Connect'}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setConnectTarget(null); setConnectPass(''); }}
                          disabled={connecting}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setConnectTarget(net);
                        setConnectPass('');
                        setUpstreamMsg('');
                      }}
                      disabled={scanning || connecting}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
