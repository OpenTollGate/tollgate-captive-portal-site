import { useState, useEffect, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';

interface DhcpLease {
  hostname: string;
  ipaddr: string;
  macaddr: string;
  expires: number;
}

export default function Devices() {
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLeases = useCallback(async () => {
    try {
      let allLeases: DhcpLease[] = [];
      try {
        const data = await ubusCall('dhcp', 'ipv4leases');
        if (data && data.device) {
          for (const dev of Object.values(data.device) as any[]) {
            if (dev.leases) {
              allLeases.push(...dev.leases);
            }
          }
        }
      } catch {
        const raw = await ubusCall('file', 'read', { path: '/tmp/dhcp.leases' });
        if (raw && raw.data) {
          allLeases = (raw.data as string).trim().split('\n').filter(Boolean).map(line => {
            const parts = line.split(/\s+/);
            return {
              expires: parts[0] ? Math.max(0, parseInt(parts[0]) - Math.floor(Date.now() / 1000)) : 0,
              macaddr: parts[1] || '',
              ipaddr: parts[2] || '',
              hostname: parts[3] || '',
            };
          });
        }
      }
      setLeases(allLeases);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load device list');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeases();
    const interval = setInterval(fetchLeases, 10000);
    return () => clearInterval(interval);
  }, [fetchLeases]);

  function formatExpiry(expires: number): string {
    if (expires === -1) return 'Static';
    if (expires === 0) return 'Expired';
    const h = Math.floor(expires / 3600);
    const m = Math.floor((expires % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
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
        <button className="btn btn-secondary btn-sm" onClick={fetchLeases}>
          Retry
        </button>
      </div>
    );
  }

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
          Devices
        </h2>
        <div className="flex items-center gap-sm">
          <span className="badge badge-accent">{leases.length} connected</span>
        </div>
      </div>

      {leases.length === 0 ? (
        <div className="card animate-in-delay-1">
          <div
            className="flex flex-col items-center justify-center"
            style={{ padding: '2rem 0' }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-dim)"
              stroke-width="1.5"
              style={{ marginBottom: '0.75rem' }}
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <p className="text-dim" style={{ fontSize: 'var(--font-size-small)' }}>
              No connected devices found
            </p>
          </div>
        </div>
      ) : (
        leases.map((lease, i) => (
          <div
            key={`${lease.macaddr}-${lease.ipaddr}`}
            className={`card animate-in-delay-${Math.min(i % 5 + 1, 4)}`}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 'var(--font-size)',
                    marginBottom: '0.1rem',
                  }}
                >
                  {lease.hostname || 'Unknown'}
                </div>
                <div
                  className="text-mono"
                  style={{
                    color: 'var(--accent)',
                    fontSize: 'var(--font-size-small)',
                  }}
                >
                  {lease.ipaddr}
                </div>
              </div>
              <span className={`badge ${lease.expires > 0 ? 'badge-success' : 'badge-muted'}`}>
                {formatExpiry(lease.expires)}
              </span>
            </div>
            <hr className="divider" />
            <div className="stat-row" style={{ borderTop: 'none', paddingTop: 0 }}>
              <span className="stat-label">MAC Address</span>
              <span className="stat-value text-mono" style={{ fontSize: 'var(--font-size-xsmall)' }}>
                {lease.macaddr}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
