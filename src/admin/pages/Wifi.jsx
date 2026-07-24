import { useState, useEffect } from 'react';
import { ubusCall } from '../lib/ubus';
import './Wifi.scss';

export default function Wifi() {
  const [networks, setNetworks] = useState([]);
  const [connected, setConnected] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [ssid, setSsid] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const fetchConnected = async () => {
    try {
      const list = await ubusCall('tollgate', 'upstream_list').catch(() => []);
      setConnected(list?.networks || list || []);
    } catch {}
  };

  useEffect(() => {
    fetchConnected();
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setFeedback(null);
    try {
      const result = await ubusCall('tollgate', 'upstream_scan');
      setNetworks(result?.networks || result || []);
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!ssid.trim()) return;
    setConnecting(true);
    setFeedback(null);
    try {
      await ubusCall('tollgate', 'upstream_connect', { ssid: ssid.trim(), passphrase });
      setFeedback({ type: 'success', message: `Connected to ${ssid}` });
      setSsid('');
      setPassphrase('');
      await fetchConnected();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setConnecting(false);
    }
  };

  const handleRemove = async (removeSsid) => {
    if (!confirm(`Remove network "${removeSsid}"?`)) return;
    try {
      await ubusCall('tollgate', 'upstream_remove', { ssid: removeSsid });
      setFeedback({ type: 'success', message: `Removed ${removeSsid}` });
      await fetchConnected();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  const selectNetwork = (net) => {
    setSsid(net.ssid || net.name || '');
    setPassphrase('');
  };

  return (
    <div className="admin-wifi">
      <h2>Wi-Fi</h2>

      {feedback && (
        <div className={feedback.type === 'error' ? 'admin-error' : 'admin-success'}>
          {feedback.message}
        </div>
      )}

      <div className="admin-wifi-section">
        <div className="admin-wifi-section-header">
          <h3>Scan Networks</h3>
          <button className="cta small" disabled={scanning} onClick={handleScan}>
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
        {networks.length > 0 && (
          <div className="admin-wifi-list">
            {networks.map((net, i) => (
              <div key={net.ssid || net.name || i} className="admin-wifi-item" onClick={() => selectNetwork(net)}>
                <span className="admin-wifi-item-name">{net.ssid || net.name}</span>
                <span className="admin-wifi-item-signal">{net.signal ?? net.quality ?? ''}</span>
                {net.encryption !== undefined && (
                  <span className="admin-wifi-item-enc">{net.encryption ? 'Secured' : 'Open'}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-wifi-section">
        <h3>Connect to Network</h3>
        <form onSubmit={handleConnect} className="admin-wifi-form">
          <div className="admin-wifi-field">
            <label>SSID</label>
            <input type="text" value={ssid} onChange={(e) => setSsid(e.target.value)} required />
          </div>
          <div className="admin-wifi-field">
            <label>Passphrase</label>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" />
          </div>
          <button type="submit" className="cta" disabled={connecting || !ssid.trim()}>
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>

      <div className="admin-wifi-section">
        <h3>Connected Networks</h3>
        {connected.length === 0 ? (
          <p className="admin-wifi-desc">No upstream networks configured.</p>
        ) : (
          <div className="admin-wifi-list">
            {connected.map((net, i) => (
              <div key={net.ssid || net.name || i} className="admin-wifi-item">
                <span className="admin-wifi-item-name">{net.ssid || net.name}</span>
                <button className="ghost small" onClick={() => handleRemove(net.ssid || net.name)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
