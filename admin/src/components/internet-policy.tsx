import { useEffect, useRef, useState } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import { activeLabel, activeUplink, healthLabel, parseInternetPolicy, type InternetPolicy, type PolicyFamily } from '../lib/internet-policy';

type Review = { enabled: boolean; baseline: { enabled: boolean; policy: string; checkMethod: string; issue: string } };

interface Props {
  policy: InternetPolicy | null;
  capability: boolean;
  loading: boolean;
  disabled: boolean;
  checkedAt: string;
  onRefresh: () => Promise<InternetPolicy | null>;
}

export default function InternetPolicyControls({ policy, capability, loading, disabled, checkedAt, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (review !== null && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [review]);

  async function refresh() {
    const fresh = await onRefresh();
    if (mounted.current && fresh) setUncertain(false);
  }

  async function apply() {
    if (review === null || actionInFlight.current) return;
    const { enabled, baseline } = review;
    actionInFlight.current = true; setReview(null); setBusy(true); setMessage(''); setError('');
    let attempted = false;
    try {
      const current = parseInternetPolicy(await ubusCall('tollgate', 'internet_policy_get'));
      if (!mounted.current) return;
      if (!current?.supported) throw new Error('Could not confirm current fallback settings. Refresh status before making changes.');
      if (current.enabled !== baseline.enabled || current.policy !== baseline.policy || current.checkMethod !== baseline.checkMethod || current.issue !== baseline.issue) {
        await onRefresh();
        throw new Error('Fallback settings changed elsewhere. Review the current state before making a new change.');
      }
      attempted = true;
      const result = await ubusCall('tollgate', 'internet_policy_set', { enabled });
      if (result?.success !== true) throw new Error('unconfirmed');
      if (!mounted.current) return;
      setMessage(enabled ? 'Automatic fallback enabled. Check each uplink below while independent checks settle.' : 'Automatic fallback disabled. The previous connection priorities have been restored.');
      await onRefresh();
    } catch (err: any) {
      if (mounted.current) {
        setError(attempted ? 'Fallback change outcome is not confirmed. Some routing changes may already have applied. Refresh fallback status before reviewing another action; no automatic retry was sent.' : err.message || 'Fallback settings unavailable.');
        if (attempted) setUncertain(true);
      }
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const blocked = disabled || loading || busy || uncertain || !capability || !policy?.supported || policy.policy !== 'ethernet-first';
  function beginReview(enabled: boolean) {
    if (blocked || !policy) return;
    setReview({ enabled, baseline: { enabled: policy.enabled, policy: policy.policy, checkMethod: policy.checkMethod, issue: policy.issue } });
  }
  function familyDetails(family: PolicyFamily, version: 'v4' | 'v6') {
    if (!policy) return null;
    return <div className="policy-family">
      <div className="stat-row"><span className="stat-label">{version === 'v4' ? 'IPv4' : 'IPv6'} for new connections</span><strong className="stat-value" data-testid={`policy-ip${version}-active`}>{activeLabel(activeUplink(policy, family))}</strong></div>
      <div className="policy-uplink" data-testid={`policy-${version}-primary`}><span>Ethernet WAN</span><span className="policy-state">{healthLabel(family.primary, policy)}</span></div>
      <div className="policy-uplink" data-testid={`policy-${version}-backup`}><span>Venue Wi-Fi</span><span className="policy-state">{healthLabel(family.backup, policy)}</span></div>
    </div>;
  }
  return <section className="internet-policy" data-testid="internet-policy" aria-label="Automatic fallback">
    <div className="policy-heading"><h3>Connection preference</h3><button className="btn btn-secondary btn-sm" disabled={disabled || loading || busy} onClick={refresh}>Refresh fallback status</button></div>
    <p><strong>Preferred: Ethernet WAN{!policy?.enabled && ' (when enabled)'}</strong><br /><span>Backup: venue Wi-Fi</span></p>
    {loading ? <p className="policy-note">Checking fallback status…</p> : !capability ? <p className="policy-note">Update the management plugin and install the fallback engine to use automatic fallback. The current default route is shown above.</p>
      : !policy ? <p className="error-text">Fallback status unavailable. The applied source is not confirmed.</p>
      : !policy.supported ? <p className="policy-note">Automatic fallback is unavailable on this router. {policy.issue ? 'Review the reported issue below before changing it.' : 'Install the supported fallback engine before enabling it.'}</p>
      : policy.policy !== 'ethernet-first' ? <p className="error-text">The fallback configuration is not recognized. Refresh status or update the management plugin before changing it.</p>
      : !policy.enabled ? <p className="policy-note">Automatic fallback is off. Ethernet-first preference has not been applied. {policy.running ? 'The engine is still reported running, so the applied source is not confirmed.' : 'The router’s current default route is shown above.'}</p>
      : <>
        <p className="policy-note">Automatic fallback is on. Healthy Ethernet is preferred; venue Wi-Fi takes over after failed checks, then Ethernet returns after stable recovery.</p>
        {!policy.running && <p className="error-text">Fallback checks are not running. The applied source and backup readiness are not confirmed. Disable automatic fallback, then review enabling it again to resume checks.</p>}
        {policy.running && policy.ipv4.active === 'wwan' && <p className="policy-fallback">Using backup Wi-Fi for IPv4 while Ethernet is unavailable or failing its internet checks.</p>}
        {familyDetails(policy.ipv4, 'v4')}
        {familyDetails(policy.ipv6, 'v6')}
        {policy.ipv6.backupSupported === false && <p className="policy-note">Wi-Fi fallback uses IPv4. IPv6 stays on checked Ethernet, or is unavailable.</p>}
        {policy.running && policy.ipv6.active === 'none' && <p className="policy-note">No healthy IPv6 uplink is available. IPv4 can continue independently.</p>}
      </>}
    <p className="policy-note">Existing connections can keep their previous uplink until they reconnect; the routes above apply to new connections.</p>
    <p className="policy-note">Backup readiness uses DNS and HTTP checks through that uplink. A cable link or a successful internet check through the other connection does not make the backup ready.</p>
    <details className="policy-preparation">
      <summary>Prepare Wi-Fi backup at a venue</summary>
      <ol>
        <li>Join the venue network from the <a href="#/wifi">WiFi page</a>, then check whether its backup state is Ready.</li>
        <li>If the venue requires browser sign-in, temporarily disable automatic fallback and unplug the WAN cable. This lets traffic use Wi-Fi even while its internet checks are blocked.</li>
        <li>On a device using TollGate’s private Wi-Fi or management LAN for internet, open a plain HTTP website and complete the venue’s sign-in.</li>
        <li>Reconnect the WAN cable and enable automatic fallback. Wait for the independent Wi-Fi check to report Ready.</li>
      </ol>
      <p className="policy-note">A browser using working Ethernet does not sign in the Wi-Fi backup. Prepare this during setup; unplugging WAN can interrupt guest connections.</p>
    </details>
    {checkedAt && !loading && <p className="policy-note">Last checked {checkedAt}. Status refreshes automatically.</p>}
    {policy?.issue && <p className="error-text" role="alert">Router reports: {policy.issue}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {message && <p className="success-text" role="status">{message}</p>}
    <div className="profit-actions">
      {!policy?.enabled && <button className="btn btn-primary btn-sm" disabled={blocked} onClick={() => beginReview(true)}>Enable automatic fallback</button>}
      {policy?.enabled && <button className="btn btn-secondary btn-sm" disabled={blocked} onClick={() => beginReview(false)}>Disable automatic fallback</button>}
    </div>
    {review !== null && <dialog ref={dialog} className="profit-dialog" aria-labelledby="policy-review-title" onCancel={event => { event.preventDefault(); setReview(null); }}>
      <h3 id="policy-review-title">{review.enabled ? 'Enable automatic fallback?' : 'Disable automatic fallback?'}</h3>
      <p>{review.enabled ? 'Prefer Ethernet WAN whenever its internet checks are healthy. Keep venue Wi-Fi as backup and return to Ethernet after stable recovery. IPv4 and IPv6 are checked and routed separately.' : 'Stop automatic health-based switching and restore the previous connection priorities. The router will use its regular routing rules.'}</p>
      {review.baseline.issue && <p className="error-text">Router reports: {review.baseline.issue}</p>}
      <p>Switching connections can change the public IP and interrupt open connections. Devices may need to reconnect. This change does not restart paid-session accounting.</p>
      <p>If the response is lost, refresh fallback status before deciding whether to repeat it.</p>
      <div className="profit-actions"><button className="btn btn-secondary" onClick={() => setReview(null)}>Cancel</button><button className="btn btn-primary" onClick={apply}>Confirm {review.enabled ? 'enable' : 'disable'}</button></div>
    </dialog>}
  </section>;
}
