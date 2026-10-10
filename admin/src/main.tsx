import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import './styles/variables.css';
import './styles/admin.css';
import { initRouter, useRoute, navigate } from './lib/router';
import {
  checkSession,
  isLoggedIn,
  isMock,
  fetchCredentialStatus,
  type CredentialStatus,
} from './lib/ubus';
import { requiresPasswordChoice } from './lib/provisional';
import { BRAND } from './brand';
import Layout from './components/layout';
import LoginPage from './routes/login';
import PasswordChoicePage from './routes/password';

// apply the build's brand chrome before first paint
document.title = `${BRAND.name} Admin`;
(() => {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = `${import.meta.env.BASE_URL}${BRAND.icon}`;
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (theme) theme.content = BRAND.themeColor;
})();

function AdminApp() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  // The router's credential facts. `provisional` is the
  // /etc/tollgate/admin-credential-provisional marker: while it stands the
  // installer GENERATED this router's password, so the board forces the owner
  // to choose their own before ANY route renders (see below).
  const [credential, setCredential] = useState<CredentialStatus | null>(null);
  const route = useRoute();

  useEffect(() => {
    initRouter();
    (async () => {
      if (isMock()) {
        // A mock/demo build must not pretend to authenticate against a router
        // that has NO root credential either. The auto-login models a router
        // that has been provisioned, so it happens only when the probe reports
        // a real credential (`set`); every other state renders the login screen
        // instead of the dashboard — `empty` as the fail-closed refusal, and
        // `locked`/`unknown` as the form itself.
        // (admin/tests/admin-credential-guard.spec.mjs drives this.)
        const status = await fetchCredentialStatus();
        setCredential(status);
        if (status.state === 'set') {
          setAuthed(true);
        } else {
          setAuthed(false);
          navigate('login');
        }
        setReady(true);
        return;
      }
      if (isLoggedIn()) {
        const valid = await checkSession();
        setAuthed(valid);
        if (valid) {
          // Read the credential facts for the session we already have, so a
          // reload lands on the forced choice rather than the dashboard.
          setCredential(await fetchCredentialStatus());
        } else {
          navigate('login');
        }
      } else {
        setAuthed(false);
        navigate('login');
      }
      setReady(true);
    })();
  }, []);

  // A genuine session expiry can be noticed by ANY route; drop auth so the
  // effect below redirects to login instead of leaving a raw SESSION_EXPIRED.
  useEffect(() => {
    const onExpired = () => setAuthed(false);
    window.addEventListener('tollgate:session-expired', onExpired);
    return () =>
      window.removeEventListener('tollgate:session-expired', onExpired);
  }, []);

  // The forced password choice owns routing while it is owed: with a
  // provisional credential the dashboard is not reachable by ANY route (the
  // hash included), so the redirect below must not race it to a dashboard.
  const mustChoosePassword = authed && requiresPasswordChoice(credential);

  useEffect(() => {
    if (!ready) return;
    if (mustChoosePassword) return;
    if (route === 'login' && authed) {
      navigate('dashboard');
    } else if (route !== 'login' && !authed) {
      navigate('login');
    }
  }, [route, authed, ready, mustChoosePassword]);

  if (!ready) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
        }}
      >
        <div className="loading-spinner loading-spinner-lg" />
      </div>
    );
  }

  // FAIL CLOSED: a router that answered "the credential is provisional" gets the
  // forced choice and NOTHING else. This branch is checked before the login
  // screen and before the layout, so no hash and no route can get past it.
  if (mustChoosePassword) {
    return (
      <PasswordChoicePage
        onChosen={() =>
          // The marker is gone: the credential is the owner's own choice now.
          setCredential((current) =>
            current ? { ...current, provisional: false } : current
          )
        }
      />
    );
  }

  if (route === 'login' || !authed) {
    return (
      <LoginPage
        onLoggedIn={(status) => {
          // The probe's answer decides whether the board opens or the forced
          // choice is owed; without it there is nothing to gate on, so one is
          // taken now (pre-auth, so it works with or without a session).
          setCredential(status ?? null);
          if (!status) {
            (async () => setCredential(await fetchCredentialStatus()))();
          }
          setAuthed(true);
        }}
      />
    );
  }

  return <Layout />;
}

render(<AdminApp />, document.getElementById('app')!);
