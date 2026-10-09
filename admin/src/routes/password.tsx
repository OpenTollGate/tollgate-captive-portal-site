import { useState } from 'preact/hooks';
import { setRootPassword, claimAdminCredential } from '../lib/ubus';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  PROVISIONAL_MARKER_PATH,
  validatePasswordChoice,
} from '../lib/provisional';
import { BRAND } from '../brand';
import { withBase } from '../lib/paths';
import ParticleBg from '../components/particle-bg';

/**
 * The forced password choice at first login.
 *
 * Reached only while /etc/tollgate/admin-credential-provisional stands, i.e.
 * when the installer GENERATED this router's admin password instead of the
 * operator choosing one (nothing at install time can prompt: uci-defaults run
 * from the package manager with no controlling terminal, so a chosen password
 * can only arrive through TOLLGATE_ADMIN_PASSWORD).
 *
 * The generated password was printed once into an install log that the next
 * full-setup run truncates, so leaving it in place is how a board ends up on a
 * credential nobody knows. This screen is the only route out: it is mounted by
 * main.tsx INSTEAD of the dashboard and instead of every other route, so the
 * board is not usable until the owner's own password is set and the marker is
 * gone.
 *
 * Order matters and is enforced here: the router sets the owner's password
 * FIRST, and only then is the marker dropped. A router that refuses either step
 * keeps the operator on this screen — no silent walk to the dashboard.
 */
export default function PasswordChoicePage({
  onChosen,
}: {
  onChosen: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    setError('');
    setBusy(true);
    try {
      setStep('Setting your password on the router…');
      await setRootPassword(password);
      setStep('Dropping the install-time credential marker…');
      await claimAdminCredential();
      // The password is not needed again: the component unmounts here.
      setPassword('');
      setConfirm('');
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
              Choose your own admin password
            </h2>

            <p
              style={{
                fontSize: 'var(--font-size-xsmall)',
                color: 'var(--text-dim)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              This router's admin password was <strong>generated for you</strong>{' '}
              at install time — it was shown once and the log it was printed to
              is gone. Pick your own now; the generated one stops working the
              moment you do.
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
              marker <code>{PROVISIONAL_MARKER_PATH}</code> while a generated
              password is in use, and removes it once you choose your own.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
