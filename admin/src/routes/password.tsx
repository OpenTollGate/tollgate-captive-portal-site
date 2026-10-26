import { useState } from 'preact/hooks';
import { adminCredentialSetup } from '../lib/ubus';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  PROVISIONAL_MARKER_PATH,
  PRIVATE_WIFI_PROVISIONAL_MARKER_PATH,
  validatePasswordChoice,
  validateWifiPassphrase,
} from '../lib/provisional';
import { BRAND } from '../brand';
import { withBase } from '../lib/paths';
import ParticleBg from '../components/particle-bg';

/**
 * The forced credential choice at first login.
 *
 * Reached while /etc/tollgate/admin-credential-provisional stands (the admin
 * password is the package default `TollGate`) or
 * /etc/tollgate/private-wifi-credential-provisional stands (the private WiFi key
 * is the default), or both. Nothing at install time can prompt: uci-defaults run
 * from the package manager with no controlling terminal, so a chosen credential
 * can only arrive through the installer's advanced fields or the environment.
 *
 * A board left on the known default would be reachable with a value anyone can
 * read off the package, so this screen is the only route out: main.tsx mounts it
 * INSTEAD of the dashboard and instead of every other route, so the board is not
 * usable until the owner's own credentials are set and the markers are gone.
 *
 * Order matters and is enforced here: the router sets the owner's credentials
 * FIRST, and only then are the markers dropped. A router that refuses either
 * step keeps the operator on this screen — no silent walk to the dashboard.
 */
export default function PasswordChoicePage({
  onChosen,
  wifiRequired = false,
}: {
  onChosen: () => void;
  wifiRequired?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [wifi, setWifi] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const problem = validatePasswordChoice(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    if (wifiRequired && wifi.trim().length < MIN_ADMIN_PASSWORD_LENGTH) {
      setError(
        `Choose a management WiFi password too — the installed one is the default. Use at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }
    // The router refuses an out-of-bounds passphrase with `weak-wifi-passphrase`,
    // but only after the submit; catching it here keeps the owner from losing a
    // round trip (and, before the router-side fix, from losing the passphrase
    // silently). Blank still means "keep the installed key".
    const wifiProblem = validateWifiPassphrase(wifi);
    if (wifiProblem) {
      setError(wifiProblem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      setStep('Setting your admin password (and WiFi) on the router…');
      // PRE-AUTH, one-shot: sets the root password AND the private-WiFi
      // passphrase while the install-time markers stand, then drops them.
      await adminCredentialSetup(password, confirm, wifi);
      setPassword('');
      setConfirm('');
      setWifi('');
      onChosen();
    } catch (err: any) {
      setStep('');
      setError(err?.message || 'The router did not accept the change');
    } finally {
      setBusy(false);
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
          id="provisional-password-choice"
          className="animate-in"
          style={{
            width: '100%',
            maxWidth: '420px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.4rem',
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
            <h2
              style={{
                fontSize: 'var(--font-size-small)',
                color: 'var(--text)',
                margin: 0,
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
              }}
            >
              Choose your own password
            </h2>

            <p
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--text-dim)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              This router was installed with a{' '}
              <strong>default password</strong> (<code>TollGate</code>) for the
              admin board
              {wifiRequired ? ' and the management WiFi' : ''}. Choose your own
              now so nobody who knows the default can reach your router. The
              default stops working the moment you set this.
            </p>

            <div className="input-group">
              <label className="input-label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                className="input"
                value={password}
                onInput={(e) =>
                  setPassword((e.target as HTMLInputElement).value)
                }
                autocomplete="new-password"
                autoFocus
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                className="input"
                value={confirm}
                onInput={(e) =>
                  setConfirm((e.target as HTMLInputElement).value)
                }
                autocomplete="new-password"
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="wifi-passphrase">
                Management WiFi password{' '}
                {wifiRequired ? '(required)' : '(optional)'}
              </label>
              <input
                id="wifi-passphrase"
                type="password"
                className="input"
                value={wifi}
                onInput={(e) => setWifi((e.target as HTMLInputElement).value)}
                autocomplete="new-password"
                placeholder={
                  wifiRequired
                    ? 'Choose a new management WiFi password'
                    : 'Leave blank to keep the current one'
                }
              />
            </div>

            <p
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--text-dim)',
                margin: 0,
              }}
            >
              At least {MIN_ADMIN_PASSWORD_LENGTH} characters. This becomes the
              password for <code>root</code> over SSH and on this board.
            </p>

            {error && (
              <div
                id="provisional-error"
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

            {busy && step && (
              <div
                id="provisional-progress"
                style={{
                  fontSize: 'var(--font-size-xsmall)',
                  color: 'var(--text-dim)',
                  textAlign: 'center',
                }}
              >
                {step}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={busy}
              style={{ marginTop: '0.4rem', height: '42px' }}
            >
              {busy ? (
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
                'Set password and continue'
              )}
            </button>

            <p
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--text-dim)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              The board stays closed until this is done. The router records the
              marker <code>{PROVISIONAL_MARKER_PATH}</code>
              {wifiRequired ? (
                <>
                  {' '}
                  (and, for the WiFi,{' '}
                  <code>{PRIVATE_WIFI_PROVISIONAL_MARKER_PATH}</code>)
                </>
              ) : null}{' '}
              while a default credential is in use, and removes it once you
              choose your own.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
