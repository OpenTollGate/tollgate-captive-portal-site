import { useState, useEffect, useCallback } from 'react';
import { ubusCall } from '../lib/ubus';
import './Dashboard.scss';

export default function Dashboard() {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        ubusCall('tollgate', 'status').catch(() => null),
        ubusCall('tollgate', 'health').catch(() => null),
      ]);
      setStatus(s);
      setHealth(h);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return <div className="admin-page-loading"><span className="spinner big"></span></div>;
  }

  return (
    <div className="admin-dashboard">
      <h2>Dashboard</h2>
      {error && <div className="admin-error">{error}</div>}

      <div className="admin-dashboard-grid">
        <div className="admin-card">
          <div className="admin-card-label">Service Status</div>
          <div className={`admin-card-value ${status?.running ? 'status-ok' : 'status-err'}`}>
            {status?.running ? 'Running' : 'Stopped'}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-label">Uptime</div>
          <div className="admin-card-value">{formatUptime(status?.uptime)}</div>
        </div>

        <div className="admin-card">
          <div className="admin-card-label">Version</div>
          <div className="admin-card-value">{status?.version || 'N/A'}</div>
        </div>

        <div className="admin-card">
          <div className="admin-card-label">Health</div>
          <div className={`admin-card-value ${health?.healthy ? 'status-ok' : 'status-err'}`}>
            {health?.healthy ? 'Healthy' : 'Unhealthy'}
          </div>
          {health?.checks && (
            <div className="admin-card-detail">
              {Object.entries(health.checks).map(([k, v]) => (
                <div key={k}>{k}: {String(v)}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {status && (
        <div className="admin-card" style={{ marginTop: '1.6rem' }}>
          <div className="admin-card-label">Raw Status</div>
          <pre className="admin-pre">{JSON.stringify(status, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds) {
  if (!seconds && seconds !== 0) return 'N/A';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
