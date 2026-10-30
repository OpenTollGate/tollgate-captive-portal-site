import { useState, useEffect, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import { navigate } from '../lib/router';
import { isPrivateRadioIface } from '../lib/private-radio';
import { refusalInApplied } from '../lib/module-reply';

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

function signalQuality(dbm: number): { label: string; color: string } {
  // Every branch is a token: the "Good" and "Fair" stops were fixed #4da6ff /
  // #e88a3a, which do not exist in the palette and did not move with it — on
  // the light palette #e88a3a on white is 2.4:1.
  if (dbm >= -50) return { label: 'Excellent', color: 'var(--success)' };
  if (dbm >= -60) return { label: 'Good', color: 'var(--accent)' };
  if (dbm >= -70) return { label: 'Fair', color: 'var(--warning)' };
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

// The private-radio save writes the passphrase before the SSID; this is what
// the operator is told when the passphrase LANDED but the SSID write did not
// (a refusal, a `success: false`, or a transport-level throw) — both radios
// then carry the previous SSID with the NEW passphrase, and that state must
// be named, not swallowed into a bare failure.
function partialKeyAppliedMessage(reason: string): string {
  return `The passphrase was applied to both private radios, but the SSID change was not — ${reason}. Both radios currently use the previous SSID with the NEW passphrase; retry the SSID on its own.`;
}

export default function Wifi() {
  const [radios, setRadios] = useState<Record<string, WifiRadio>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editSsid, setEditSsid] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editName, setEditName] = useState('');
  // Which interface a save message belongs to. The message has to OUTLIVE the
  // edit form: on success the form closes in the same render that sets the
  // message, so a message rendered inside the form was never seen at all — a
  // successful save reported nothing, while a failed one (which leaves the form
  // open) reported in red. That read as "nothing happened" for the private
  // radios, whose save now goes through the module.
  const [saveMsgSection, setSaveMsgSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

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

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function startEdit(ifname: string, ssid: string) {
    setEditSsid(ifname);
    setEditName(ssid);
    setEditPassword('');
    setSaveMsg('');
    setSaveMsgSection(null);
  }

  // The structural half of the private-radio contract (mode, network) lives
  // on the iface object, not on the section name — see lib/private-radio.ts.
  function findIfaceBySection(section: string): WifiIface | undefined {
    for (const radio of Object.values(radios)) {
      const hit = radio.interfaces?.find(
        (i) => (i.section || i.ifname) === section,
      );
      if (hit) return hit;
    }
    return undefined;
  }

  async function saveEdit() {
    if (!editSsid) return;
    // The message is bound to this interface now, while its name is still known.
    setSaveMsgSection(editSsid);
    setSaving(true);
    setSaveMsg('');
    // Set once the passphrase write has landed: a later failure on the SSID
    // write — whatever its shape — leaves a partial state the catch must
    // name too, not only the refusal paths that check it inline.
    let privateKeyApplied = false;
    try {
      // The private (management) radios are owned by the module's config: their
      // SSID and passphrase are `private_ssid`/`private_key` in config.json, and
      // the service writes BOTH radios from it. Editing one section by raw UCI
      // here would be reverted at the next service start, and would leave the
      // 2.4 GHz and 5 GHz SSIDs different — so the edit goes through
      // `config_set` instead, which is the one writer. Which sections count as
      // private is the module's contract, pinned in lib/private-radio.ts.
      if (isPrivateRadioIface(editSsid, findIfaceBySection(editSsid))) {
        // The passphrase goes FIRST. A value the module will refuse (WPA2-PSK
        // bounds) is then refused before anything on the router has changed,
        // so the operator retries from an untouched state instead of from a
        // half-applied save.
        if (editPassword) {
          const keyRes = await ubusCall('tollgate', 'config_set', {
            key: 'private_key',
            value: editPassword,
          });
          const keyFailure = keyRes.success
            ? refusalInApplied(keyRes)
            : `Failed: ${keyRes.error || 'the module could not apply this change'}`;
          if (keyFailure) {
            setSaveMsg(keyFailure);
            return;
          }
          privateKeyApplied = true;
        }
        const res = await ubusCall('tollgate', 'config_set', {
          key: 'private_ssid',
          value: editName,
        });
        const ssidFailure = res.success
          ? refusalInApplied(res)
          : `Failed: ${res.error || 'the module could not apply this change'}`;
        if (ssidFailure) {
          setSaveMsg(editPassword ? partialKeyAppliedMessage(ssidFailure) : ssidFailure);
          return;
        }
        setSaveMsg('saved to both private radios — the service applies it now');
        setEditSsid(null);
        setTimeout(() => fetchStatus(), 2000);
        return;
      }

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
      setSaveMsg(
        privateKeyApplied
          ? partialKeyAppliedMessage(err.message || 'the module could not be reached')
          : err.message || 'Failed to save',
      );
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
                {saveMsg && saveMsgSection === section && (
                  saveMsg.startsWith('saved') ? (
                    <p className="success-text" id="wifi-save-message">
                      {saveMsg === 'saved' ? 'Changes applied' : saveMsg}
                    </p>
                  ) : (
                    <p className="error-text" id="wifi-save-message">{saveMsg}</p>
                  )
                )}
              </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="card animate-in-delay-3">
        <div className="card-header"><div className="card-title">Peering</div></div>
        <div className="card-body flex flex-col gap-sm">
          <p className="text-dim">Find fellow TollGate operators, peer with them, and stack SATs.</p>
          <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('peering')}>
            Manage peering →
          </button>
        </div>
      </div>
    </div>
  );
}
