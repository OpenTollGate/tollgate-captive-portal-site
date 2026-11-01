import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import { navigate } from '../lib/router';

interface NetworkInterface {
  interface: string;
  up: boolean;
  l3_device?: string;
  metric?: number;
  route?: { target: string; mask: number; metric?: number; nexthop?: string }[];
  'ipv4-address'?: { address: string }[];
  'ipv6-address'?: { address: string }[];
}

interface Snapshot {
  online?: boolean;
  source: string;
  address: string;
  checkedAt: string;
  revision: number;
}

// An enabled interface or configured STA is not proof of the selected uplink.
// Choose an up default route, respecting the route/interface metric.
function currentSource(interfaces: NetworkInterface[], upstreams: { ssid: string; status: string }[]) {
  const routes = interfaces.flatMap((iface) => !iface?.up || !Array.isArray(iface.route) ? [] : iface.route
    .filter((route) => route.mask === 0 && (route.target === '0.0.0.0' || route.target === '::'))
    .map((route) => ({ iface, family: route.target, metric: route.metric ?? iface.metric ?? 0 })));
  // IPv4 and IPv6 metrics are independent. If their preferred paths differ,
  // or equal-cost paths exist, do not pretend we know a single source.
  const preferred = routes.filter((route) => !routes.some((other) => other.family === route.family && other.metric < route.metric));
  const names = new Set(preferred.map(({ iface }) => iface.interface));
  if (names.size > 1) return { source: 'Multiple uplinks', address: 'More than one default route' };
  const iface = preferred[0]?.iface;
  if (!iface) return { source: 'Source not confirmed', address: 'Not reported' };
  const wireless = /^wwan/.test(iface.interface) || /(?:sta|wlan)/.test(iface.l3_device || '');
  const active = upstreams.find((upstream) => upstream?.status === 'ACTIVE');
  const source = wireless
    ? `Wi-Fi${active?.ssid ? ` · ${active.ssid}` : ''}`
    : /^wan/.test(iface.interface) ? 'Ethernet' : 'Another uplink';
  return {
    source,
    address: iface['ipv4-address']?.[0]?.address || iface['ipv6-address']?.[0]?.address || 'Not reported',
  };
}

export default function InternetConnection({
  showConnect = false,
  refreshKey = 0,
  connecting = false,
}: { showConnect?: boolean; refreshKey?: number; connecting?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checking, setChecking] = useState(true);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setChecking(true);
    const [status, network, upstreams] = await Promise.allSettled([
      ubusCall('tollgate', 'status'),
      ubusCall('network.interface', 'dump'),
      ubusCall('tollgate', 'upstream_list'),
    ]);
    if (id !== requestId.current) return;
    const online = status.status === 'fulfilled' && status.value?.success
      ? status.value.data?.network_ok : undefined;
    const interfaces = network.status === 'fulfilled' && Array.isArray(network.value?.interface)
      ? network.value.interface : [];
    const known = upstreams.status === 'fulfilled' && upstreams.value?.success && Array.isArray(upstreams.value.data)
      ? upstreams.value.data : [];
    setSnapshot({
      online: typeof online === 'boolean' ? online : undefined,
      ...currentSource(interfaces, known),
      checkedAt: new Date().toLocaleTimeString(),
      revision: refreshKey,
    });
    setChecking(false);
  }, [refreshKey]);

  useEffect(() => {
    if (!connecting) refresh();
    // A join changes the upstream while reads may still be in flight. Never
    // let a response from before the join (or an unmounted page) claim success.
    return () => { requestId.current++; };
  }, [refresh, refreshKey, connecting]);

  const stale = snapshot?.revision !== refreshKey;
  const busy = connecting || checking || stale;
  const label = connecting ? 'Connecting to venue Wi-Fi…'
    : checking || stale ? 'Checking internet…'
    : snapshot?.online === true ? 'Internet working'
    : snapshot?.online === false ? 'Internet not confirmed'
    : 'Internet check unavailable';

  return (
    <section className="card internet-source" data-testid="internet-connection" aria-label="Internet source">
      <div className="card-header">
        <div className="card-title">Internet source</div>
        <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={busy}>Check internet</button>
      </div>
      <div className="card-body flex flex-col gap-sm">
        <div role="status" aria-live="polite">
          <span className={`badge ${!busy && snapshot?.online === true ? 'badge-success' : 'badge-muted'}`}>{label}</span>
        </div>
        {!busy && snapshot && (
          <>
            <div className="stat-row"><span className="stat-label">Source</span><span className="stat-value">{snapshot.source}</span></div>
            <div className="stat-row"><span className="stat-label">IP address</span><span className="stat-value">{snapshot.address}</span></div>
            <p className="text-dim">Last checked {snapshot.checkedAt}</p>
          </>
        )}
        {!busy && snapshot?.online === false && (
          <p className="text-dim">If the venue requires a browser sign-in, open a plain HTTP website on a device using TollGate for internet. A failed check can also mean a weak signal or an outage. After signing in or fixing the connection, check again.</p>
        )}
        {!busy && snapshot?.online === undefined && (
          <p className="text-dim">The router did not return an internet check result. Try again; a Wi-Fi connection alone does not confirm internet access.</p>
        )}
        {showConnect && (
          <button className="btn btn-primary" onClick={() => navigate('wifi')}>Connect to venue Wi-Fi</button>
        )}
      </div>
    </section>
  );
}
