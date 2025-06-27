import React from 'react';
import ReactDOM from 'react-dom/client';

/* Load App and Styles */
import './index.scss';
import App from './App.jsx';

/* Internationalisation */
import './helpers/i18n';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
); 