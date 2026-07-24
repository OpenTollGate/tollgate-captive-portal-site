import { useState } from 'react';
import logoWhite from '../../assets/logo/TollGate_Logo-C-white.png';
import { logout as doLogout, getSessionUser } from '../lib/ubus';
import './Layout.scss';

const NAV_ITEMS = [
  { hash: '#/', label: 'Dashboard', icon: '◉' },
  { hash: '#/settings', label: 'Settings', icon: '⚙' },
  { hash: '#/wallet', label: 'Wallet', icon: '₿' },
  { hash: '#/wifi', label: 'Wi-Fi', icon: '📶' },
  { hash: '#/devices', label: 'Devices', icon: '💻' },
];

export default function Layout({ children, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    doLogout();
    onLogout();
  };

  return (
    <div className="admin-layout">
      <aside className={`admin-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="admin-sidebar-header">
          <img src={logoWhite} alt="TollGate" className="admin-sidebar-logo" />
        </div>
        <nav className="admin-sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.hash}
              href={item.hash}
              className={`admin-sidebar-link${window.location.hash === item.hash ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="admin-sidebar-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="admin-sidebar-overlay" onClick={() => setSidebarOpen(false)} style={{ display: sidebarOpen ? 'block' : 'none' }} />

      <main className="admin-main">
        <header className="admin-header">
          <button className="admin-header-menu" onClick={() => setSidebarOpen(!sidebarOpen)}>
            ☰
          </button>
          <h1 className="admin-header-title">TollGate Admin</h1>
          <div className="admin-header-right">
            <span className="admin-header-user">{getSessionUser()}</span>
            <button className="ghost small" onClick={handleLogout}>Logout</button>
          </div>
        </header>
        <div className="admin-content">
          {children}
        </div>
      </main>
    </div>
  );
}
