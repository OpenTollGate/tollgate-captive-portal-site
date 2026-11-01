import { useEffect, useRef, useState } from 'preact/hooks';
import { ubusCall, fetchUiLinks } from '../lib/ubus';
import type { UiLinks } from '../lib/ui-links';
import UiCrossLink from '../components/ui-cross-link';
import PrivateNetworkControls from '../components/private-network-controls';

type Action = 'start' | 'stop' | 'restart';
const labels = { start: 'Start', stop: 'Stop', restart: 'Restart' };

export default function Maintenance() {
  const [facts, setFacts] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [links, setLinks] = useState<UiLinks | null>(null);
  const [supported, setSupported] = useState({ start: false, stop: false, restart: false });
  const [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [review, setReview] = useState<Action | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [checked, setChecked] = useState('');
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);

  async function refresh() {
    setReading(true);
    const [status, healthResult, capabilities, uiLinks] = await Promise.allSettled([
      ubusCall('tollgate', 'status'), ubusCall('tollgate', 'health'),
      ubusCall('tollgate', 'auth_status'), fetchUiLinks(),
    ]);
    if (!mounted.current) return;
    setFacts(status.status === 'fulfilled' && status.value?.success === true ? status.value.data : null);
    setHealth(healthResult.status === 'fulfilled' && healthResult.value?.success === true ? healthResult.value.data : null);
    const caps = capabilities.status === 'fulfilled' ? capabilities.value : null;
    setSupported({ start: caps?.service_controls_supported === true, stop: caps?.service_controls_supported === true, restart: caps?.service_restart_supported === true });
    setLinks(uiLinks.status === 'fulfilled' ? uiLinks.value : null);
    setChecked(new Date().toLocaleTimeString());
    setUncertain(false);
    setReading(false);
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (review && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [review]);

  async function apply() {
    if (!review || actionInFlight.current) return;
    const action = review;
    actionInFlight.current = true;
    setReview(null); setBusy(true); setError(''); setMessage('');
    try {
      const result = await ubusCall('tollgate', `service_${action}`);
      if (result?.success !== true) throw new Error('service command refused or incomplete');
      if (!mounted.current) return;
      setMessage(`${labels[action]} command completed. Check the diagnostics below for the current response; this does not confirm guest purchases or the running allocation.`);
      await refresh();
    } catch {
      if (mounted.current) {
        setError(`${labels[action]} outcome is not confirmed. Changes may have partially applied. Refresh diagnostics before reviewing another action; nothing will be retried automatically.`);
        setUncertain(true);
        setFacts(null); setHealth(null);
      }
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const status = reading ? 'Checking…' : facts?.running === true ? 'Responding' : facts?.running === false ? 'Reported stopped' : 'Not responding';
  const fact = (value: unknown) => reading ? 'Checking…' : value === true ? 'OK' : value === false ? 'Needs attention' : 'Unavailable';
  return <div className="flex flex-col gap-md maintenance">
    <h2 style={{ fontSize: 'var(--font-size-large)' }}>Maintenance</h2>
    <section className="card" aria-label="TollGate service">
      <div className="card-header"><h3 className="card-title">TollGate service</h3><button className="btn btn-secondary btn-sm" disabled={busy || reading || privateBusy} onClick={refresh}>Refresh diagnostics</button></div>
      <dl className="maintenance-facts">
        <div><dt>Service API</dt><dd>{status}</dd></div>
        <div><dt>Configuration</dt><dd>{fact(facts?.config_ok)}</dd></div>
        <div><dt>Internet probe</dt><dd>{fact(facts?.network_ok)}</dd></div>
        <div><dt>Wallet</dt><dd>{facts?.wallet_degraded ? 'Degraded' : fact(facts?.wallet_ok)}</dd></div>
        <div><dt>Health API</dt><dd>{reading ? 'Checking…' : health ? 'Available' : 'Unavailable'}</dd></div>
      </dl>
      {facts?.wallet_degraded && <p className="error-text" role="alert">Wallet needs attention: {facts.wallet_reason || 'the service reported degraded operation'}.</p>}
      {!reading && !facts && <p className="error-text">Service diagnostics are unavailable. A failed read alone does not prove the service is stopped. Start remains available when supported.</p>}
      {checked && <p className="text-muted">Last check: {checked}. The running payout allocation is not reported; these checks do not confirm that guests can buy access.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {message && <p role="status" className="success-text">{message}</p>}
      <div className="profit-actions">{(['start', 'stop', 'restart'] as Action[]).map(action => <button className="btn btn-secondary" disabled={busy || reading || privateBusy || uncertain || !supported[action]} onClick={() => setReview(action)}>{labels[action]} TollGate</button>)}</div>
      {(!supported.start || !supported.stop) && !reading && <p className="text-dim">The management plugin needs an update for start and stop controls.</p>}
      <details><summary>When do saved settings apply?</summary><p>General, pricing and allocation changes may load at the next service startup. The module reports immediate application or refusal for private Wi-Fi credentials and administration access. Restarting ends active paid sessions. Guests may need to pay again.</p></details>
    </section>
    <PrivateNetworkControls serviceResponding={facts?.running === true} disabled={busy || reading} onBusyChange={setPrivateBusy} />
    <section className="card" aria-label="Owner controls">
      <h3 className="card-title">Owner controls</h3>
      <div className="maintenance-links">
        <a href="#/wifi">Venue Wi-Fi and radio settings →</a>
        <a href="#/settings">Pricing, mints and payout destinations →</a>
        <a href="#/settings">Private Wi-Fi name, password and admin access →</a>
        <a href="#/wallet">Wallet balance, fund and withdraw →</a>
      </div>
    </section>
    <section className="card" aria-label="Advanced router settings">
      <h3 className="card-title">Advanced router settings</h3>
      <p className="text-dim">These controls open in the router’s LuCI interface. Use the same router login.</p>
      <UiCrossLink payload={links} label="Open advanced router settings" />
      <ul className="maintenance-coverage">
        <li><strong>Network → Wireless:</strong> private Wi-Fi on/off, radio channels and transmit power. Reloading wireless can interrupt venue and guest Wi-Fi. Keep a wired management connection before disabling private Wi-Fi.</li>
        <li><strong>Network → Interfaces:</strong> DHCP and LAN settings. Use the address control above for TollGate management-address pinning. Network changes can disconnect this dashboard.</li>
        <li><strong>Network → Firewall:</strong> forwarding and firewall rules. TollGate’s administration-access setting remains in Settings.</li>
        <li><strong>System:</strong> Firmware, backups and reboot; system logs for troubleshooting. Backups and logs can contain sensitive information.</li>
        <li><strong>Services → uHTTPd, when installed:</strong> advanced HTTPS listener and certificate settings. The LuCI link above is the router’s reported HTTPS address; certificate coverage does not establish browser trust.</li>
      </ul>
      <details><summary>Specialist recovery and identity operations</summary><p>Signing keys, seed recovery, certificate replacement and creating new public payout identities need dedicated protected workflows. They are not exposed as raw file editors. Existing public payout addresses and shares are editable in Settings; full identity replacement can remove the router’s signing identity.</p></details>
    </section>
    {review && <dialog ref={dialog} className="profit-dialog" aria-labelledby="service-review-title" onCancel={event => { event.preventDefault(); setReview(null); }}>
      <h3 id="service-review-title">{labels[review]} TollGate?</h3>
      {review === 'start' ? <p>This starts NoDogSplash and TollGate when needed. Saved settings load when a new service process starts. It does not restore previous paid-session metering.</p> : <p>{review === 'stop' ? 'Stopping prevents new purchases and stops TollGate and NoDogSplash.' : 'Restarting loads saved settings and ends active paid sessions.'} <strong>Guests may need to pay again.</strong></p>}
      <p>No unsaved form edits are applied. If the response is lost, check diagnostics before deciding whether to repeat this action.</p>
      <div className="profit-actions"><button className="btn btn-secondary" onClick={() => setReview(null)}>Cancel</button><button className="btn btn-primary" onClick={apply}>Confirm {review}</button></div>
    </dialog>}
  </div>;
}
