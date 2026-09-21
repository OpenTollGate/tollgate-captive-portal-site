import { useState, useEffect, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';

interface MintBalance {
  url: string;
  balance: number;
}

interface DrainToken {
  mint_url: string;
  balance_sats: number;
  token: string;
}

export default function Wallet() {
  const [balance, setBalance] = useState<number>(0);
  const [mints, setMints] = useState<MintBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [fundToken, setFundToken] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [fundMessage, setFundMessage] = useState('');

  const [drainLoading, setDrainLoading] = useState(false);
  const [drainMessage, setDrainMessage] = useState('');
  const [drainTokens, setDrainTokens] = useState<DrainToken[]>([]);
  const [drainConfirm, setDrainConfirm] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await ubusCall('tollgate', 'wallet_info');
      if (res.success && res.data) {
        setBalance(res.data.total_balance || 0);
        const mintBalances = res.data.mint_balances || {};
        setMints(
          Object.entries(mintBalances).map(([url, balance]) => ({
            url,
            balance: balance as number,
          }))
        );
      }
      setError('');
    } catch {
      setBalance(0);
      setMints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  async function handleFund() {
    if (!fundToken.trim()) return;
    setFundLoading(true);
    setFundMessage('');
    try {
      const res = await ubusCall('tollgate', 'wallet_fund', { token: fundToken.trim() });
      if (res.success) {
        setFundMessage(`Funded with ${res.data?.amount_received || '?'} sats`);
        setFundToken('');
        fetchWallet();
      } else {
        setFundMessage(`Error: ${res.error || 'fund failed'}`);
      }
    } catch (err: any) {
      setFundMessage(`Error: ${err.message}`);
    } finally {
      setFundLoading(false);
    }
  }

  async function handleDrain() {
    setDrainLoading(true);
    setDrainMessage('');
    setDrainTokens([]);
    setDrainConfirm(false);
    try {
      const res = await ubusCall('tollgate', 'wallet_drain_cashu');
      if (res.success && res.data?.tokens) {
        setDrainTokens(res.data.tokens);
        setDrainMessage(`Drained ${res.data.total_sats || res.data.total || 0} sats from ${res.data.tokens.length} mint(s)`);
        fetchWallet();
      } else {
        setDrainMessage(`Error: ${res.error || 'drain failed'}`);
      }
    } catch (err: any) {
      setDrainMessage(`Error: ${err.message}`);
    } finally {
      setDrainLoading(false);
    }
  }

  function copyToken(token: string, idx: number) {
    navigator.clipboard.writeText(token).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {});
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
        <button className="btn btn-secondary btn-sm" onClick={fetchWallet}>Retry</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <h2
        className="animate-in"
        style={{ fontSize: 'var(--font-size-large)', fontWeight: 700 }}
      >
        Wallet
      </h2>

      <div className="card animate-in-delay-1">
        <div className="card-header">
          <div className="card-title">Balance</div>
          <button className="btn btn-secondary btn-sm" onClick={fetchWallet}>Refresh</button>
        </div>
        <div style={{ fontSize: 'var(--font-size-large)', fontWeight: 700, color: 'var(--accent)' }}>
          {balance.toLocaleString()} sats
        </div>
        {mints.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            {mints.map((mint) => (
              <div key={mint.url} className="stat-row" style={{ fontSize: 'var(--font-size-small)' }}>
                <span className="stat-label" style={{ wordBreak: 'break-all', maxWidth: '70%' }}>{mint.url}</span>
                <span className="stat-value">{mint.balance.toLocaleString()} sats</span>
              </div>
            ))}
          </div>
        )}
        {mints.length === 0 && balance === 0 && (
          <p className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginTop: '0.3rem' }}>
            No funds in wallet
          </p>
        )}
      </div>

      <div className="card animate-in-delay-2">
        <div className="card-header">
          <div className="card-title">Fund Wallet</div>
        </div>
        <div className="flex flex-col gap-sm">
          <textarea
            className="input"
            rows={3}
            value={fundToken}
            onInput={(e) => setFundToken((e.target as HTMLTextAreaElement).value)}
            placeholder="Paste Cashu token (cashuA…)"
            style={{ fontSize: 'var(--font-size-small)', resize: 'vertical' }}
          />
          <div className="flex items-center gap-sm">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleFund}
              disabled={!fundToken.trim().startsWith('cashu') || fundLoading}
            >
              {fundLoading ? 'Processing…' : 'Fund'}
            </button>
            {fundMessage && (
              <span className={fundMessage.startsWith('Error') ? 'error-text' : 'success-text'}>
                {fundMessage}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card animate-in-delay-3">
        <div className="card-header">
          <div className="card-title">Drain Wallet</div>
        </div>
        <p className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginBottom: '0.5rem' }}>
          Extract all funds as Cashu tokens. This will empty the wallet.
        </p>
        {!drainConfirm ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setDrainConfirm(true)}
            disabled={balance === 0 || drainLoading}
          >
            Drain All Funds
          </button>
        ) : (
          <div className="flex gap-sm">
            <button className="btn btn-primary btn-sm" onClick={handleDrain} disabled={drainLoading}>
              {drainLoading ? 'Draining…' : 'Confirm Drain'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDrainConfirm(false)}>
              Cancel
            </button>
          </div>
        )}
        {drainMessage && (
          <p className={drainMessage.startsWith('Error') ? 'error-text' : 'success-text'} style={{ marginTop: '0.5rem' }}>
            {drainMessage}
          </p>
        )}
        {drainTokens.length > 0 && (
          <div style={{ marginTop: '0.5rem' }} className="flex flex-col gap-sm">
            {drainTokens.map((dt, idx) => (
              <div key={idx} style={{ background: 'var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: 'var(--font-size-xsmall)', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                    {dt.mint_url}
                  </span>
                  <span style={{ fontWeight: 600 }}>{dt.balance_sats.toLocaleString()} sats</span>
                </div>
                <div className="flex gap-sm">
                  <input
                    className="input"
                    value={dt.token}
                    readOnly
                    style={{ fontSize: 'var(--font-size-xsmall)', fontFamily: 'monospace' }}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => copyToken(dt.token, idx)}
                  >
                    {copiedIdx === idx ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
