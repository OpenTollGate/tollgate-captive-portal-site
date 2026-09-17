import { useState } from 'preact/hooks';
import { isMock, login } from '../lib/ubus';
import { withBase } from '../lib/paths';
import { navigate } from '../lib/router';
import { BRAND } from '../brand';
import ParticleBg from '../components/particle-bg';

export default function LoginPage({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const mockMode = isMock();
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      onLoggedIn?.();
      navigate('dashboard');
    } catch (err: any) {
      setError(err.message === 'Invalid username or password'
        ? 'Invalid credentials'
        : err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ParticleBg />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
        }}
      >
        <div
          className="animate-in"
          style={{
            width: '100%',
            maxWidth: '360px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.8rem',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <img
              src={withBase(BRAND.logo)}
              alt={BRAND.name}
              style={{ height: '44px', marginBottom: '0.4rem' }}
            />
            <p
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--text-dim)',
                marginTop: '0.5rem',
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
              }}
            >
              Router Admin
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{
              width: '100%',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div className="input-group">
              <label className="input-label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                className="input"
                value={username}
                onInput={(e) =>
                  setUsername((e.target as HTMLInputElement).value)
                }
                autocomplete="username"
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onInput={(e) =>
                  setPassword((e.target as HTMLInputElement).value)
                }
                placeholder="Enter password"
                autocomplete="current-password"
                autoFocus
              />
            </div>

            {error && (
              <div
                className="error-text"
                style={{
                  textAlign: 'center',
                  padding: '0.45rem 0.6rem',
                  background: 'rgba(255,69,58,0.1)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
              style={{ marginTop: '0.4rem', height: '42px' }}
            >
              {loading ? (
                <div
                  className="loading-spinner"
                  style={{
                    width: '16px',
                    height: '16px',
                    borderTopColor: '#fff',
                    border: '2px solid rgba(255,255,255,0.3)',
                  }}
                />
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p
            style={{
              fontSize: 'var(--font-size-xsmall)',
              color: 'var(--text-dim)',
              textAlign: 'center',
            }}
          >
            {BRAND.name} &middot; {BRAND.poweredBy}
          </p>

          <a
            href={`http://${window.location.hostname}:8080/`}
            style={{
              fontSize: 'var(--font-size-xsmall)',
              color: 'var(--text-dim)',
              textDecoration: 'none',
              opacity: 0.7,
            }}
          >
            OpenWrt LuCI →
          </a>

          {mockMode && (
            <a
              href={withBase('mockups/')}
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--accent)',
                textDecoration: 'none',
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
              }}
            >
              Open published mockups
            </a>
          )}
        </div>
      </div>
    </>
  );
}
