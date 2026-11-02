// external
import React from 'react';
import ReactDOM from 'react-dom/client';

// internal
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

// helpers
import './helpers/i18n';

// styles and assets
import './index.scss';
import './cobrador-island.scss';

if (import.meta.env.VITE_THEME === 'cobrador-island') {
  document.documentElement.classList.add('theme-cobrador-island');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
); 