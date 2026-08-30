import { useState, useEffect } from 'react';
import { isLoggedIn, checkSession } from './lib/ubus';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Wallet from './pages/Wallet';
import Wifi from './pages/Wifi';
import Devices from './pages/Devices';

function Router({ onLogout }) {
  const hash = window.location.hash || '#/';

  const routes = {
    '#/': Dashboard,
    '#/settings': Settings,
    '#/wallet': Wallet,
    '#/wifi': Wifi,
    '#/devices': Devices,
  };

  const exactMatch = routes[hash];
  const Page = exactMatch || Dashboard;

  if (!exactMatch && hash !== '#/') {
    window.location.hash = '#/';
    return null;
  }

  return (
    <Layout onLogout={onLogout}>
      <Page />
    </Layout>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      if (isLoggedIn()) {
        const valid = await checkSession();
        setAuthenticated(valid);
      }
      setChecking(false);
    })();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const handleHash = () => setAuthenticated((v) => v);
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [authenticated]);

  if (checking) {
    return (
      <div className="admin-page-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span className="spinner big"></span>
      </div>
    );
  }

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  return <Router onLogout={() => setAuthenticated(false)} />;
}
