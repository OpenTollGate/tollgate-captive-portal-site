import { Component } from 'react';

// Crash surface. It renders OUTSIDE the app tree, so it must not import a
// stylesheet (that is how a broken style graph takes the error page down with
// it). It reads the same custom properties the app paints from instead of
// hardcoding last-theme hex, so the fallback page follows the palette too; the
// explicit second argument to var() is the pre-theme colour, so this renders
// sanely even if the token layer itself failed to load.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--color-bg, #14161d)',
          color: 'var(--color, #eef1f7)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: 'var(--color-dim, #8e99ad)', marginBottom: '1.5rem' }}>
            The portal encountered an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.75rem 2rem',
              fontSize: '1rem',
              background: 'var(--color-cta, #ff6961)',
              color: 'var(--color-on-accent, #1a1114)',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload Portal
          </button>
          {this.state.error && (
            <details style={{ marginTop: '2rem', color: 'var(--color-dim, #8e99ad)', maxWidth: '600px' }}>
              <summary style={{ cursor: 'pointer' }}>Error details</summary>
              <pre style={{ fontSize: '0.75rem', overflow: 'auto', marginTop: '0.5rem' }}>
                {this.state.error?.message || String(this.state.error)}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
