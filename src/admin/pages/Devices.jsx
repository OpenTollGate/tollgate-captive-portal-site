import { useState, useEffect } from 'react';
import { ubusCall } from '../lib/ubus';
import './Devices.scss';

export default function Devices() {
  const [leases, setLeases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const result = await ubusCall('dhcp', 'ipv4leases');
        const leaseList = result?.leases || result || [];
        setLeases(leaseList);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ubusCall('dhcp', 'ipv4leases');
      setLeases(result?.leases || result || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="admin-page-loading"><span className="spinner big"></span></div>;
  }

  return (
    <div className="admin-devices">
      <div className="admin-devices-header">
        <h2>Devices</h2>
        <button className="cta small" onClick={handleRefresh}>Refresh</button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {leases.length === 0 ? (
        <p className="admin-devices-desc">No DHCP leases found.</p>
      ) : (
        <div className="admin-devices-table-wrap">
          <table className="admin-devices-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>IP Address</th>
                <th>MAC Address</th>
                <th>Lease Remaining</th>
              </tr>
            </thead>
            <tbody>
              {leases.map((lease, i) => (
                <tr key={lease.mac || lease.hwaddr || i}>
                  <td>{lease.hostname || '-'}</td>
                  <td>{lease.ipaddr || lease.ip || '-'}</td>
                  <td className="admin-devices-mac">{lease.mac || lease.hwaddr || '-'}</td>
                  <td>{formatExpiry(lease.expire || lease.expiry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatExpiry(seconds) {
  if (!seconds && seconds !== 0) return '-';
  if (seconds <= 0) return 'Expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
