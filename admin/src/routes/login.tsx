import { useState, useEffect } from 'preact/hooks';
import {
  isMock,
  login,
  fetchCredentialStatus,
  type CredentialStatus,
} from '../lib/ubus';
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
  // The router's root credential state, probed BEFORE the form is offered.
  // null while the probe is in flight.
  const [credential, setCredential] = useState<CredentialStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await fetchCredentialStatus();
      if (!cancelled) setCredential(status);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const credentialUnset = credential !== null && credential.state === 'empty';
  const credentialLocked = credential !== null && credential.state === 'locked';
  const credentialUnknown = credential !== null && credential.state === 'unknown';
  const blankPassword = password === '';

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');
    // Never send a blank credential: on a router with an unset root hash ANY
    // password (including "") authenticates, so a blank one would produce a
    // session that proves nothing.
    if (blankPassword) {
      setError('Enter the router password — an empty password is not accepted');
      return;
    }
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

          {credentialUnset ? (
            // FAIL CLOSED. The router's root /etc/shadow hash is unset, so
            // rpcd's session.login accepts ANY password — including an empty
            // one — and the session it hands out carries this board's ACL
            // (file exec, system.password_set, wallet_drain_cashu). Offering a
            // login form here would hand out root administration to whoever
            // reaches :8090, so the board refuses instead of pretending to
            // authenticate.
            <div
              id="credential-refusal"
              data-credential-state={credential?.state}
              style={{
                width: '100%',
                background: 'var(--card)',
                border: '1px solid rgba(255,69,58,0.5)',
                borderRadius: 'var(--radius)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <h2
                style={{
                  fontSize: 'var(--font-size-small)',
                  color: 'var(--text)',
                  margin: 0,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase' as const,
                }}
              >
                Admin board disabled
              </h2>
              <p
                style={{
                  fontSize: 'var(--font-size-xsmall)',
                  color: 'var(--text-dim)',
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                This router has <strong>no root password set</strong>, so the
                board refuses to sign anyone in. While root's password hash is
                empty the router accepts <em>any</em> password, so a successful
                login would prove nothing and would hand out full
                administration.
              </p>
              <p
                style={{
                  fontSize: 'var(--font-size-xsmall)',
                  color: 'var(--text-dim)',
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                Fix it on the router: over SSH or LuCI run{' '}
                <code>passwd root</code> (or re-run the TollGate installer and
                give it a password), then reload this page.
              </p>
            </div>
          ) : credential === null ? (
            <div
              id="credential-probe"
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--text-dim)',
                padding: '1rem 0',
              }}
            >
              Checking router credentials…
            </div>
          ) : (
            <>
              {credentialLocked && (
                // LOCKED is not credential-less — nobody can authenticate with a
                // password against a lock sentinel — so the form stays, but the
                // owner is told why their password cannot work instead of
                // reading it as a wrong password.
                <div
                  id="credential-locked"
                  data-credential-state="locked"
                  style={{
                    fontSize: 'var(--font-size-xsmall)',
                    color: 'var(--text-dim)',
                    background: 'rgba(255,159,10,0.1)',
                    border: '1px solid rgba(255,159,10,0.4)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.6rem 0.75rem',
                    lineHeight: 1.5,
                  }}
                >
                  This router's root account is <strong>locked</strong>, so no
                  password can sign in. Set one on the router first:{' '}
                  <code>passwd root</code> over SSH or LuCI (or re-run the
                  TollGate installer and give it a password).
                </div>
              )}

              {credentialUnknown && (
                <div
                  id="credential-unknown"
                  style={{
                    fontSize: 'var(--font-size-xsmall)',
                    color: 'var(--text-dim)',
                    background: 'rgba(255,159,10,0.1)',
                    border: '1px solid rgba(255,159,10,0.4)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.6rem 0.75rem',
                    lineHeight: 1.5,
                  }}
                >
                  Could not read the router's credential state (older package,
                  or the router did not answer). Sign-in is allowed, but the
                  router itself refuses privileged calls while root has no
                  password.
                </div>
              )}

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

            {blankPassword && (
              <div
                id="password-required-hint"
                className="hint"
                style={{
                  fontSize: 'var(--font-size-xsmall)',
                  color: 'var(--text-dim)',
                }}
              >
                The router password is required — an empty password is not
                accepted.
              </div>
            )}

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
              disabled={loading || blankPassword}
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
            </>
          )}

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
