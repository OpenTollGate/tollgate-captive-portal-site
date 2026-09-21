// external
import React from 'react';
import ReactDOM from 'react-dom/client';

// internal
import App from './App.jsx';
import { ToastProvider } from './components/ToastContext';
import ToastContainer from './components/Toast';

// helpers
import './helpers/i18n';

// styles and assets
import './index.scss';

// render app in element with id root
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <ToastContainer />
    </ToastProvider>
  </React.StrictMode>
);