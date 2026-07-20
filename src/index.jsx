// external
import React from 'react';
import ReactDOM from 'react-dom/client';

// internal
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeProvider';

// helpers
import './helpers/i18n';

// styles and assets
import './index.scss';

// render app in element with id root
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);