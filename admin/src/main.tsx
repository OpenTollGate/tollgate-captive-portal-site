import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import './styles/variables.css';
import './styles/admin.css';
import { initRouter, useRoute, navigate } from './lib/router';
import { checkSession, isLoggedIn, isMock } from './lib/ubus';
import { BRAND } from './brand';
import Layout from './components/layout';
import LoginPage from './routes/login';

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
  const route = useRoute();

  useEffect(() => {
    initRouter();
    (async () => {
      if (isMock()) {
        setAuthed(true);
        setReady(true);
        return;
      }
      if (isLoggedIn()) {
        const valid = await checkSession();
        setAuthed(valid);
        if (!valid) navigate('login');
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

  useEffect(() => {
    if (!ready) return;
    if (route === 'login' && authed) {
      navigate('dashboard');
    } else if (route !== 'login' && !authed) {
      navigate('login');
    }
  }, [route, authed, ready]);

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

  if (route === 'login' || !authed) {
    return <LoginPage onLoggedIn={() => setAuthed(true)} />;
  }

  return <Layout />;
}

render(<AdminApp />, document.getElementById('app')!);
