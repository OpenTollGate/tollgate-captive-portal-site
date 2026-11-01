import { useEffect, useRef, useState } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';

function usableAddress(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/24)?$/.exec(value);
  return !!match && match.slice(1).every(n => Number(n) <= 255 && (n === '0' || !n.startsWith('0')))
    && Number(match[4]) > 0 && Number(match[4]) < 255;
}
type Action = 'enable' | 'disable' | 'address';

export default function PrivateNetworkControls({ disabled, serviceResponding, onBusyChange }: { disabled?: boolean; serviceResponding: boolean; onBusyChange: (busy: boolean) => void }) {
  const [metadata, setMetadata] = useState<any>(null);
  const [caps, setCaps] = useState<any>(null);
  const [address, setAddress] = useState('');
  const [wired, setWired] = useState(false);
  const [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);

  async function refresh() {
    setReading(true);
    const [capability, data] = await Promise.allSettled([ubusCall('tollgate', 'auth_status'), ubusCall('tollgate', 'private_network_get')]);
    if (!mounted.current) return;
    setCaps(capability.status === 'fulfilled' ? capability.value : null);
    setMetadata(data.status === 'fulfilled' && data.value?.success === true ? data.value : null);
    setUncertain(false); setReading(false);
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (review && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [review]);
  async function apply() {
    if (!review || inFlight.current) return;
    const action = review;
    inFlight.current = true; setReview(null); setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try {
      const reply = await ubusCall('tollgate', action === 'address' ? 'private_set_address' : `private_${action}`, action === 'address' ? { address } : {});
      if (reply?.success !== true) throw new Error('unconfirmed');
      if (!mounted.current) return;
      if (action === 'address') {
        setReconnect(true);
        setMessage(`Address change accepted. Record ${address.replace('/24', '')}/24 and reconnect on that subnet. A network reload may still be pending; this page does not prove the new address is reachable. ${reply.message || ''}`);
      } else {
        setMessage(`Private Wi-Fi ${action} command completed. Refresh the configured radio state below; this does not verify broadcasting.`);
        await refresh();
      }
    } catch {
      if (mounted.current) { setError(`Private network outcome is not confirmed. A change may have applied. Check your connection and refresh state before deciding whether to repeat it. For an address change, try the new subnet as well. No automatic retry was sent.`); setUncertain(true); }
    } finally { inFlight.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  const locked = disabled || reading || busy || uncertain || reconnect;
  return <section className="card" aria-label="Private management network">
    <div className="card-header"><h3 className="card-title">Private management network</h3><button className="btn btn-secondary btn-sm" disabled={disabled || reading || busy || reconnect} onClick={refresh}>Refresh network state</button></div>
    <p className="text-dim">The owner’s private network is separate from guest access. Name and password are in <a href="#/settings">Settings</a>.</p>
    {metadata ? <dl className="maintenance-facts"><div><dt>Configured address</dt><dd>{metadata.address || 'Unavailable'}</dd></div><div><dt>Address pinned for setup/upgrades</dt><dd>{metadata.pinned_address || 'Not pinned'}</dd></div><div><dt>Private interface 0</dt><dd>{metadata.radio0 || 'Unavailable'}</dd></div><div><dt>Private interface 1</dt><dd>{metadata.radio1 || 'Unavailable'}</dd></div></dl> : <p>{reading ? 'Reading network state…' : 'Private network state unavailable. Update the management plugin if this router does not support these controls.'}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}{message && <p className="success-text" role="status">{message}</p>}
    {!serviceResponding && <p className="text-dim">Start TollGate before changing the private network. Local metadata remains available.</p>}
    <label className="maintenance-confirm"><input type="checkbox" checked={wired} disabled={locked} onChange={event => setWired(event.currentTarget.checked)} /> I have a wired management connection</label>
    <p className="text-dim">Wireless reloads can interrupt venue and guest Wi-Fi. A wired connection provides a recovery path; changing the address can still require reconnecting your computer on the new subnet.</p>
    <div className="profit-actions"><button className="btn btn-secondary" disabled={locked || !serviceResponding || !wired || caps?.private_network_supported !== true || !metadata} onClick={() => setReview('enable')}>Enable private Wi-Fi</button><button className="btn btn-secondary" disabled={locked || !serviceResponding || !wired || caps?.private_network_supported !== true || !metadata} onClick={() => setReview('disable')}>Disable private Wi-Fi</button></div>
    <details><summary>Change the management address</summary>
      <p>This pins the address in both TollGate’s durable setup store and the router interface. Choose an unused /24 subnet that does not overlap the venue uplink. Changing it reloads networking and can disconnect this page.</p>
      <label className="input-label" htmlFor="private-address">New management address</label><input id="private-address" className="input" value={address} placeholder="10.9.8.1/24" disabled={locked} onInput={event => setAddress(event.currentTarget.value)} />
      <button className="btn btn-secondary" disabled={locked || !serviceResponding || !wired || !metadata || caps?.private_address_supported !== true || !usableAddress(address)} onClick={() => setReview('address')}>Review address change</button>
      {caps?.private_address_supported !== true && !reading && <p className="text-dim">Address pinning needs a TollGate CLI with network private set-address support and an updated management plugin.</p>}
    </details>
    {review && <dialog ref={dialog} className="profit-dialog" aria-labelledby="private-review-title" onCancel={event => { event.preventDefault(); setReview(null); }}><h3 id="private-review-title">{review === 'address' ? 'Change management address?' : `${review === 'enable' ? 'Enable' : 'Disable'} private Wi-Fi?`}</h3>
      {review === 'address' ? <p>The router address will be <strong>{address.replace('/24', '')}/24</strong>. Record it now. Your computer must reconnect on the same subnet, including over Ethernet. The current dashboard address may stop responding. HTTPS may warn if the certificate does not cover the new address.</p> : <p>This reloads wireless and may interrupt venue and guest Wi-Fi. Disabling the private network removes its Wi-Fi management access. Keep the wired management connection available.</p>}
      <div className="profit-actions"><button className="btn btn-secondary" onClick={() => setReview(null)}>Cancel</button><button className="btn btn-primary" onClick={apply}>Confirm {review === 'address' ? 'address change' : review}</button></div>
    </dialog>}
  </section>;
}
