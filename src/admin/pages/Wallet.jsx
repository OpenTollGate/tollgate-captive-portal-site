import { useState, useEffect } from 'react';
import { ubusCall } from '../lib/ubus';
import './Wallet.scss';

export default function Wallet() {
  const [balance, setBalance] = useState(null);
  const [info, setInfo] = useState(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [draining, setDraining] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fetchWallet = async () => {
    try {
      const [b, i] = await Promise.all([
        ubusCall('tollgate', 'wallet_balance').catch(() => null),
        ubusCall('tollgate', 'wallet_info').catch(() => null),
      ]);
      setBalance(b);
      setInfo(i);
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallet();
  }, []);

  const handleFund = async () => {
    if (!token.trim()) return;
    setFunding(true);
    setFeedback(null);
    try {
      const result = await ubusCall('tollgate', 'wallet_fund', { token: token.trim() });
      setFeedback({ type: 'success', message: `Funded: ${JSON.stringify(result)}` });
      setToken('');
      await fetchWallet();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setFunding(false);
    }
  };

  const handleDrain = async () => {
    if (!confirm('Drain all wallet funds? This will send tokens to the configured destination.')) return;
    setDraining(true);
    setFeedback(null);
    try {
      const result = await ubusCall('tollgate', 'wallet_drain_cashu');
      setFeedback({ type: 'success', message: `Drain result: ${JSON.stringify(result)}` });
      await fetchWallet();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setDraining(false);
    }
  };

  if (loading) {
    return <div className="admin-page-loading"><span className="spinner big"></span></div>;
  }

  const mints = info?.mints || [];

  return (
    <div className="admin-wallet">
      <h2>Wallet</h2>

      {feedback && (
        <div className={feedback.type === 'error' ? 'admin-error' : 'admin-success'}>
          {feedback.message}
        </div>
      )}

      <div className="admin-wallet-grid">
        <div className="admin-card">
          <div className="admin-card-label">Total Balance</div>
          <div className="admin-card-value">{balance?.balance ?? balance?.total ?? 'N/A'} sats</div>
        </div>

        {mints.map((mint, idx) => (
          <div key={mint.url || idx} className="admin-card">
            <div className="admin-card-label">{mint.url || `Mint ${idx + 1}`}</div>
            <div className="admin-card-value">{mint.balance ?? 'N/A'} sats</div>
          </div>
        ))}
      </div>

      <div className="admin-wallet-section">
        <h3>Fund Wallet</h3>
        <div className="admin-wallet-fund">
          <textarea
            placeholder="Paste Cashu token..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
          />
          <button className="cta" disabled={funding || !token.trim()} onClick={handleFund}>
            {funding ? 'Funding...' : 'Fund'}
          </button>
        </div>
      </div>

      <div className="admin-wallet-section">
        <h3>Drain Wallet</h3>
        <p className="admin-wallet-desc">Send all funds to the configured drain destination.</p>
        <button className="ghost cta" disabled={draining} onClick={handleDrain}>
          {draining ? 'Draining...' : 'Drain All'}
        </button>
      </div>
    </div>
  );
}
