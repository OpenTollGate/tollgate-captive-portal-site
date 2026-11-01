import { useEffect, useRef, useState } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import { refusalInApplied } from '../lib/module-reply';
import { allocationError, redistribute, validLightningAddress, type ShareDraft } from '../lib/profit-share';

interface Share { identity: string; factor: number }
interface Recipient { name: string; address: string }
interface View { shares: Share[]; recipients: Recipient[] }
interface Fresh extends View { config: Record<string, any> }
type Review = { kind: 'destination'; name: string; address: string; previous: string }
  | { kind: 'allocation'; rows: ShareDraft[] } | { kind: 'restart' };

async function readSettings(): Promise<Fresh> {
  const result = await ubusCall('tollgate', 'config_get');
  const data = result?.data;
  if (!result?.success || !Array.isArray(data?.config?.profit_share) || !Array.isArray(data?.identities?.public_identities)) {
    throw new Error('Payout settings are unavailable. No changes can be saved.');
  }
  return {
    config: data.config,
    shares: data.config.profit_share.map((row: Share) => ({ identity: row.identity, factor: row.factor })),
    // Never keep signing identities or private keys in editor state or writes.
    recipients: data.identities.public_identities.map((row: any) => ({ name: row.name, address: row.lightning_address || '' })),
  };
}

const drafts = (shares: Share[]): ShareDraft[] => shares.map(row => {
  const percent = String(Number((row.factor * 100).toPrecision(12)));
  return { identity: row.identity, percent, originalFactor: row.factor, originalPercent: percent };
});
const allocation = (rows: ShareDraft[]): Share[] => rows.map(row => ({ identity: row.identity,
  factor: row.originalFactor !== undefined && row.percent === row.originalPercent ? row.originalFactor : Number(row.percent) / 100 }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const delay = () => new Promise(resolve => setTimeout(resolve, 1000));

export default function ProfitShareEditor({ disabled = false, onBusyChange }: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [rows, setRows] = useState<ShareDraft[]>([]);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [restartSupported, setRestartSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState('');
  const [restartChecked, setRestartChecked] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [addName, setAddName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const actionInFlight = useRef(false);

  function accept(next: View) {
    setView({ shares: next.shares, recipients: next.recipients });
    setRows(drafts(next.shares));
    setAddresses(Object.fromEntries(next.recipients.map(row => [row.name, row.address])));
  }

  async function reload() {
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      const [next, capability] = await Promise.all([readSettings(), ubusCall('tollgate', 'auth_status').catch(() => null)]);
      if (!mounted.current) return;
      accept(next); setRestartSupported(capability?.service_restart_supported === true);
    } catch (err: any) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
  }

  useEffect(() => { reload(); return () => { mounted.current = false; onBusyChange?.(false); }; }, []);
  useEffect(() => { if (review && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [review]);

  const allocationDirty = !!view && !same(allocation(rows), view.shares);
  const dirtyAddresses = view?.recipients.filter(row => (addresses[row.name] || '').trim() !== row.address) || [];
  const duplicateNames = !!view && new Set(view.recipients.map(row => row.name)).size !== view.recipients.length;
  const missing = rows.some(row => !view?.recipients.some(recipient => recipient.name === row.identity));
  const invalid = allocationError(rows) || (missing ? 'Every allocation needs an existing payout recipient.' : '');
  const blocked = busy || disabled || duplicateNames;
  const mixed = allocationDirty && dirtyAddresses.length > 0;
  const total = rows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);

  async function checkService() {
    setBusy(true); onBusyChange?.(true); setMessage('');
    try {
      const result = await ubusCall('tollgate', 'health');
      setRestartChecked(true);
      if (result?.success && result.data?.status === 'ok' && result.data?.config_ok === true && result.data?.wallet_ok === true) {
        setMessage('TollGate is responding. This does not confirm a previous restart or the running allocation.');
      } else setError('TollGate is not reporting healthy. A previous restart may have completed only partly; review before trying again.');
    } catch { setRestartChecked(true); setError('Service status is unavailable. The restart outcome remains unknown; review before trying again.'); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  async function applyReview() {
    if (!review || !view || busy || disabled || actionInFlight.current) return;
    actionInFlight.current = true;
    const request = review;
    const expected = view;
    setReview(null); setBusy(true); onBusyChange?.(true); setError(''); setMessage('');
    let mutationAttempted = false;
    try {
      const fresh = await readSettings();
      if (request.kind === 'destination') {
        const matches = fresh.recipients.map((row, index) => ({ ...row, index })).filter(row => row.name === request.name);
        if (matches.length !== 1 || matches[0].address !== request.previous) {
          accept(fresh); throw new Error('The destination changed elsewhere. Review the current address before saving.');
        }
        mutationAttempted = true;
        const result = await ubusCall('tollgate', 'config_set', {
          key: `identities.public_identities.${matches[0].index}.lightning_address`, value: request.address,
        });
        const observed = await readSettings();
        accept(observed);
        if (!result?.success || refusalInApplied(result) || observed.recipients.find(row => row.name === request.name)?.address !== request.address) {
          throw new Error('Destination save was not confirmed. The displayed address is what the router now reports; it may already affect the next payout pass. Review before explicitly saving again.');
        }
        setUncertain('');
        setMessage('Destination saved. It is used when the next payout pass selects recipients; an in-progress payout may retain the previous address.');
      } else if (request.kind === 'allocation') {
        if (!same(fresh.shares, expected.shares) || !same(fresh.recipients, expected.recipients)) {
          accept(fresh); throw new Error('Payout settings changed elsewhere. Review the current allocation and destinations before saving.');
        }
        const problem = allocationError(request.rows);
        if (problem) throw new Error(problem);
        const nextShares = allocation(request.rows);
        mutationAttempted = true;
        const result = await ubusCall('tollgate', 'config_save', { json: JSON.stringify({ ...fresh.config, profit_share: nextShares }) });
        const observed = await readSettings();
        accept(observed);
        if (!result?.success || refusalInApplied(result) || !same(observed.shares, nextShares)) {
          throw new Error('Allocation save was not confirmed. The displayed allocation is what the router now reports. Review before explicitly saving again.');
        }
        setUncertain('');
        setMessage('Allocation saved. Restart TollGate to load it. The running allocation is not reported.');
      } else {
        if (!same(fresh.shares, expected.shares) || !same(fresh.recipients, expected.recipients)) {
          accept(fresh); throw new Error('Payout settings changed elsewhere. Review them before restarting.');
        }
        mutationAttempted = true;
        setRestartChecked(false);
        const result = await ubusCall('tollgate', 'service_restart');
        if (!result?.success) throw new Error('Restart outcome is not confirmed. Services may be partly restarted. Check status before deciding whether to restart again.');
        setMessage('Restart commands completed. Checking whether TollGate is responding…');
        let ready = false;
        for (let attempt = 0; attempt < 5 && mounted.current; attempt++) {
          const health = await ubusCall('tollgate', 'health').catch(() => null);
          if (health?.success && health.data?.status === 'ok' && health.data?.config_ok === true && health.data?.wallet_ok === true) { ready = true; break; }
          if (attempt < 4) await delay();
        }
        if (!ready) throw new Error('Restart commands completed, but service readiness is not confirmed. Check status; do not automatically restart again.');
        setUncertain('');
        setMessage('TollGate is responding and healthy after restart. Saved percentages load at service startup.');
      }
    } catch (err: any) {
      if (mutationAttempted) {
        const observed = await readSettings().catch(() => null);
        if (observed && mounted.current) accept(observed);
        setUncertain(request.kind === 'destination' ? request.name : request.kind);
      }
      const fallback = request.kind === 'restart' ? 'Restart outcome is not confirmed. Check status before deciding whether to restart again.'
        : 'Save outcome is not confirmed. Displayed values reflect the latest available read; review before explicitly saving again.';
      if (mounted.current) { setError(mutationAttempted && !err.message?.includes('confirmed') ? fallback : err.message || fallback); setMessage(''); }
    } finally { actionInFlight.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
  }

  return (
    <section className="card profit-share" data-testid="profit-share-editor" aria-label="Profit Share">
      <div className="card-header"><h3 className="card-title">Profit Share</h3><button className="btn btn-secondary btn-sm" onClick={reload} disabled={busy || disabled}>Reload settings</button></div>
      <p className="text-dim">Set payout addresses and saved shares. Share changes load when TollGate restarts; the running allocation is not reported.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="success-text" role="status">{message}</p>}
      {duplicateNames && <p className="error-text" role="alert">Recipient names are duplicated. Editing is disabled until they are corrected.</p>}
      {!view ? <p>{busy ? 'Loading payout settings…' : 'Payout settings unavailable.'}</p> : <>
        <div className="profit-bar" aria-hidden="true">{rows.map((row, index) => <span key={row.identity} style={{ width: `${Math.max(0, Math.min(100, Number(row.percent) || 0))}%`, background: `var(--profit-${index % 4})` }} />)}</div>
        <p className={invalid ? 'error-text' : 'text-dim'}>Total: {total.toFixed(2)}%</p>
        {invalid && <p className="error-text">{invalid}</p>}
        {mixed && <p className="error-text">Save or discard one kind of change before editing the other. Destinations and percentages take effect at different times.</p>}
        {rows.map((row, index) => {
          const recipient = view.recipients.find(entry => entry.name === row.identity);
          const address = (addresses[row.identity] || '').trim();
          const dirty = !!recipient && address !== recipient.address;
          return <div className="profit-recipient" key={row.identity} data-testid={`payout-recipient-${row.identity}`}>
            <div className="profit-recipient-title"><strong>{row.identity === 'owner' ? 'Owner' : row.identity}</strong><span className="text-dim">{row.percent || '0'}%</span></div>
            <label className="input-label" htmlFor={`payout-address-${index}`}>Lightning address</label>
            <input id={`payout-address-${index}`} type="text" className="input" autoComplete="off" spellcheck={false} value={addresses[row.identity] || ''} disabled={blocked || !recipient || (dirtyAddresses.length > 0 && !dirty)}
              onInput={event => { const value = event.currentTarget.value; setAddresses(previous => ({ ...previous, [row.identity]: value })); }} placeholder="recipient@example.com" />
            <button className="btn btn-secondary btn-sm" disabled={blocked || allocationDirty || !validLightningAddress(address) || (!dirty && uncertain !== row.identity)}
              onClick={() => setReview({ kind: 'destination', name: row.identity, address, previous: recipient?.address || '' })}>Review destination</button>
            <div className="profit-share-inputs">
              <label className="input-label" htmlFor={`payout-percent-${index}`}>Share percentage</label>
              <input id={`payout-percent-${index}`} className="input" type="number" min="0" max="100" step="0.01" value={row.percent} disabled={blocked}
                onInput={event => { const value = event.currentTarget.value; setRows(previous => previous.map((entry, i) => i === index ? { ...entry, percent: value } : entry)); }} />
              <input type="range" min={row.identity === 'owner' ? '0.01' : '0'} max={row.identity === 'owner' ? '100' : '99.99'} step="0.01" value={Number(row.percent) || 0} aria-label={`${row.identity} allocation slider`} style={{ accentColor: `var(--profit-${index % 4})` }} disabled={blocked}
                onInput={event => { const value = Number(event.currentTarget.value); setRows(previous => redistribute(previous, index, value)); }} />
            </div>
            {row.identity !== 'owner' && <button className="btn btn-secondary btn-sm" disabled={blocked} onClick={() => setRows(previous => previous.filter((_, i) => i !== index))}>Remove from allocation</button>}
          </div>;
        })}
        <p className="text-dim">Sliders adjust the other shares proportionally. Percentage fields allow exact edits; the total must be 100%. Save or discard a destination edit before editing another address. Recipient names stay fixed so existing payouts keep their references.</p>
        <div className="profit-add"><label className="input-label" htmlFor="payout-add">Add an existing recipient</label>
          <select id="payout-add" className="input" value={addName} disabled={blocked} onChange={event => setAddName(event.currentTarget.value)}>
            <option value="">Choose recipient</option>{view.recipients.filter(recipient => !rows.some(row => row.identity === recipient.name)).map(recipient => <option key={recipient.name} value={recipient.name}>{recipient.name}</option>)}
          </select><button className="btn btn-secondary btn-sm" disabled={blocked || !addName} onClick={() => { setRows(previous => [...previous, { identity: addName, percent: '0' }]); setAddName(''); }}>Add recipient</button>
        </div>
        <div className="profit-actions">
          <button className="btn btn-primary btn-sm" disabled={blocked || !!invalid || dirtyAddresses.length > 0 || (!allocationDirty && uncertain !== 'allocation') || rows.some(row => Number(row.percent) > 0 && !validLightningAddress(addresses[row.identity] || ''))}
            onClick={() => setReview({ kind: 'allocation', rows: rows.map(row => ({ ...row })) })}>Review allocation</button>
          <button className="btn btn-secondary btn-sm" disabled={blocked || !allocationDirty} onClick={() => setRows(drafts(view.shares))}>Discard allocation edits</button>
          <button className="btn btn-secondary btn-sm" disabled={blocked || dirtyAddresses.length === 0} onClick={() => setAddresses(Object.fromEntries(view.recipients.map(row => [row.name, row.address])))}>Discard destination edits</button>
        </div>
        <div className="profit-apply">
          <button className="btn btn-secondary" disabled={blocked || !restartSupported || !!invalid || allocationDirty || dirtyAddresses.length > 0 || (!!uncertain && !(uncertain === 'restart' && restartChecked))} onClick={() => setReview({ kind: 'restart' })}>Restart TollGate to apply</button>
          <button className="btn btn-secondary btn-sm" disabled={busy || disabled} onClick={checkService}>Check service status</button>
          <details><summary>What does restarting do?</summary><p>Saved percentages load at service startup. Restarting ends active paid sessions. Guests may need to pay again. Address changes are selected on a subsequent payout pass; an in-progress payout may keep its previous address.</p></details>
          {!restartSupported && <p className="text-dim">This management plugin does not support restarting from the admin. Update it before using this action.</p>}
        </div>
      </>}
      {review && <dialog ref={dialog} className="profit-dialog" onCancel={event => { event.preventDefault(); setReview(null); }} aria-labelledby="payout-review-title">
        <h3 id="payout-review-title">{review.kind === 'destination' ? 'Review payout destination' : review.kind === 'allocation' ? 'Review saved allocation' : 'Restart TollGate?'}</h3>
        {review.kind === 'destination' ? <><p>{review.name}</p><p className="profit-address">{review.previous || 'No address'} → <strong>{review.address}</strong></p><p>This changes where that recipient’s sats go when the next payout pass selects recipients. An in-progress payout may retain the old address. Saving sends no test payment.</p></>
          : review.kind === 'allocation' ? <><ul>{review.rows.map(row => <li key={row.identity}><strong>{row.identity}: {row.percent}%</strong><br /><span className="profit-address">{view?.recipients.find(recipient => recipient.name === row.identity)?.address || 'No address'}</span></li>)}</ul><p>These percentages are saved for the next service startup. They do not replace the running allocation until TollGate restarts.</p></>
          : <><p>Restarting ends all active paid sessions. <strong>Guests may need to pay again.</strong></p><p>The service will load the saved allocation. No unsaved edits are applied. If the response is lost, check status before deciding whether to restart again.</p></>}
        {uncertain && <p className="error-text">The previous outcome was not confirmed. This is a new, explicit action; review the displayed settings carefully.</p>}
        <div className="profit-actions"><button className="btn btn-secondary" onClick={() => setReview(null)}>Cancel</button><button className="btn btn-primary" onClick={applyReview}>{review.kind === 'destination' ? 'Save destination' : review.kind === 'allocation' ? 'Save allocation' : 'Confirm restart'}</button></div>
      </dialog>}
    </section>
  );
}
