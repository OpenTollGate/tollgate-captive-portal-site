import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Footer, Header, Loading } from './App.jsx';
import Background from './components/Background.jsx';
import { Error, Success } from './components/Status.jsx';
import { fetchBalanceData, formatMetricValue, getMetricLabel } from './helpers/balance.js';

import './App.scss';
import './BalancePage.scss';

const REFRESH_INTERVAL_MS = 5000;

const StatCard = ({ label, value, detail }) => {
  return <div className="tollgate-captive-portal-balance-card">
    <p className="tollgate-captive-portal-balance-card-label">{label}</p>
    <p className="tollgate-captive-portal-balance-card-value">{value}</p>
    {detail && <p className="tollgate-captive-portal-balance-card-detail">{detail}</p>}
  </div>;
};

const formatDisplayValue = (amount, metric, i18n) => {
  const formatted = formatMetricValue(amount, metric, i18n);
  return `${formatted.value} ${formatted.unit}`.trim();
};

const BalancePage = () => {
  const { t, ready } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ready) {
      return;
    }

    let active = true;

    const loadBalance = async (initial = false) => {
      if (initial) {
        setLoading(true);
      }

      const response = await fetchBalanceData(t);
      if (!active) {
        return;
      }

      if (response.status) {
        setBalance(response.value);
        setError(null);
      } else {
        setError(response);
      }

      if (initial) {
        setLoading(false);
      }
    };

    loadBalance(true);
    const interval = window.setInterval(() => loadBalance(false), REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [ready, t]);

  const metric = balance?.metric || '';
  const remaining = balance ? formatDisplayValue(balance.remaining, metric, t) : '';
  const usage = balance ? formatDisplayValue(balance.usage, metric, t) : '';
  const allotment = balance ? formatDisplayValue(balance.allotment, metric, t) : '';
  const startedAt = balance?.start_time ? new Date(balance.start_time * 1000).toLocaleString() : '';

  return <div id="tollgate-captive-portal" className="tollgate-captive-portal tollgate-captive-portal-balance-page">
    <Background />

    <div className="tollgate-captive-portal-interface">
      <Header />

      <div className="tollgate-captive-portal-content">
        <div className="tollgate-captive-portal-content-container">
          <div className="tollgate-captive-portal-view">
            {loading && <Loading />}

            {!loading && error && <div className="tollgate-captive-portal-error">
              <Error label={error.label} code={error.code} message={error.message} />
              <div className="tollgate-captive-portal-balance-actions">
                <button className="cta" onClick={() => window.location.reload()}>{t('refresh_balance')}</button>
                <a href="/splash.html" className="btn ghost">{t('return_to_portal')}</a>
              </div>
            </div>}

            {!loading && !error && balance && !balance.session_active && <div className="tollgate-captive-portal-balance-panel">
              <div className="tollgate-captive-portal-method-header">
                <h1>{t('balance_page_title')}</h1>
                <h2>{t('balance_no_session_message')}</h2>
              </div>
              <div className="tollgate-captive-portal-balance-actions">
                <a href="/splash.html" className="btn cta">{t('return_to_portal')}</a>
              </div>
            </div>}

            {!loading && !error && balance && balance.session_active && <div className="tollgate-captive-portal-balance-panel">
              <div className="tollgate-captive-portal-method-header">
                <h1>{t('balance_page_title')}</h1>
                <h2>{t('balance_page_subtitle')}</h2>
              </div>

              <Success
                label={t('balance_active_label')}
                info={remaining}
                message={t('balance_active_message')}
              />

              <div className="tollgate-captive-portal-balance-grid">
                <StatCard label={t('balance_remaining')} value={remaining} />
                <StatCard label={t('balance_used')} value={usage} />
                <StatCard label={t('balance_total')} value={allotment} />
                <StatCard label={t('balance_metric')} value={getMetricLabel(metric, t)} detail={startedAt ? t('balance_started_at', { value: startedAt }) : ''} />
              </div>

              <div className="tollgate-captive-portal-balance-actions">
                <button className="ghost" onClick={() => window.location.reload()}>{t('refresh_balance')}</button>
                <a href="/splash.html" className="btn ghost">{t('return_to_portal')}</a>
              </div>
            </div>}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  </div>;
};

export default BalancePage;
