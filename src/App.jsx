// external
import { useState, useRef, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import classNames from 'classnames';

// internal
import Background from './components/Background.jsx'
import Cashu from './components/Cashu.jsx'
import Lightning from './components/Lightning.jsx'
import { BalancePage } from './components/BalancePage.jsx'
import { Error } from './components/Status.jsx';
import { AccessGrantedIcon, RadioButtonIcon } from './components/Icon.jsx'

// helpers
import { fetchTollgateData, getStepSizeValues, getTollgateBaseUrl } from './helpers/tollgate.js'

// styles and assets
import './App.scss'

// import the tollgate logos
import logoWhite from './assets/logo/TollGate_Logo-C-white.png';

// main component
export const App = () => {
  const { t, ready } = useTranslation();
  const [method, setMethod] = useState('cashu');
  const [tollgateDetails, setTollgateDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const retryIntervalRef = useRef(null);

  // initial data fetch on translation ready
  useEffect(() => {
    if (ready) {
      const fetch = async () => {
        setLoading(true);
        const response = await fetchTollgateData(t);

        if (!response.status) {
          setRetrying(true);
          setError(response);
        } else {
          setTollgateDetails(response);
        }

        setLoading(false);
      };

      fetch();

      // cleanup on unmount
      return () => {
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
        }
      };
    }
  }, [ready]);

  // set up retry mechanism when there's an error
  useEffect(() => {
    // only set up retry if there's an error and no existing retry interval
    if (!error || tollgateDetails || retryIntervalRef.current) {
      return;
    }

    console.log('setting up retry interval for tollgate details');
    setRetrying(true);

    // set up the retry interval
    retryIntervalRef.current = setInterval(async () => {
      console.log('retrying to fetch tollgate details...');
      const response = await fetchTollgateData(t);

      // if successful, clear the interval
      if (response.status) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
        setTollgateDetails(response);
        setRetrying(false);
        setError(false);
      }
    }, 5000);

    // cleanup function
    return () => {
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
    };
  }, [error, tollgateDetails]);

  // main render
  return (
    <div id="tollgate-captive-portal" className="tollgate-captive-portal">
      <Background />

      <div className="tollgate-captive-portal-interface">
        <Header />

        <div className="tollgate-captive-portal-content">
          <div className="tollgate-captive-portal-content-container">

            <div className="tollgate-captive-portal-tabs" aria-label={t('tab_aria_label')} data-hidden={!loading && !!error}>
              <Tab type="cashu" method={method} setMethod={setMethod} />
              <Tab type="balance" method={method} setMethod={setMethod} />
              <Tab type="lightning" method={method} setMethod={setMethod} />
            </div>

            <div className="tollgate-captive-portal-view">
              {loading && <Loading />}

              {!loading && error && error.isBackendNotice && <div className="tollgate-captive-portal-error">
                <Error label={error.label} code={error.code} message={error.message} />
                {retrying && <div className="tollgate-captive-portal-retrying">
                  <span className="spinner"></span>
                  {t('retrying')}
                </div>}
              </div>}

              {!loading && error && !error.isBackendNotice && <div className="tollgate-captive-portal-error">
                <Error label={error.label} code={error.code} message={error.message} />
                {retrying && <div className="tollgate-captive-portal-retrying">
                  <span className="spinner"></span>
                  {t('retrying')}
                </div>}
              </div>}

              {/* show cashu, lightning, or the balance page based on selection */}
              {!loading && !error && method === 'cashu' && <Cashu tollgateDetails={tollgateDetails.value} />}
              {!loading && !error && method === 'lightning' && <Lightning tollgateDetails={tollgateDetails.value} />}
              {!loading && !error && method === 'balance' && <BalancePage tollgateDetails={tollgateDetails.value} onNavigate={setMethod} />}
            </div>

          </div>
        </div>

        <Footer />
      </div>

    </div>
  );
}

// header component showing tollgate logo above container
export const Header = () => {
  const { t } = useTranslation();

  return <div className="tollgate-captive-portal-header">
    <img src={logoWhite} alt={t('header_image_alt')}></img>
  </div>
}

// tab component for the container header
const Tab = ({ type, method, setMethod }) => {
  const { t } = useTranslation();
  const isLightning = type === 'lightning';
  const isDisabled = isLightning; // Lightning is disabled

  return <button
    onClick={() => !isDisabled && setMethod(type)}
    data-active={method === type}
    data-disabled={isDisabled}
    className={`tollgate-captive-portal-tabs-tab tollgate-captive-portal-tabs-tab-${type} ellipsis ${isDisabled ? 'disabled' : ''}`}
    label={t(`${type}_tab`)}
    id={`tab-${type}`}
    aria-controls={`tab-${type}`}
    disabled={isDisabled}>
    {isLightning ? `${t(`${type}_tab`)} (Coming Soon)` : t(`${type}_tab`)}
  </button>
}

// loading component shows a spinner
export const Loading = () => {
  const { t } = useTranslation();

  return <div className="tollgate-captive-portal-loading">
    <span className="spinner big"></span>
    {t('loading')}
  </div>
}

// processing component shows a spinner
export const Processing = ({ label }) => {
  const { t } = useTranslation();

  if (!label || "string" !== typeof label || !label.length) label = t('processing')

  return <div className="tollgate-captive-portal-processing">
    <span className="spinner big"></span>
    {label}
  </div>
}

// shows access granted message if payment succeeded
export const AccessGranted = ({ allocation }) => {
  const { t } = useTranslation();
  const [authCompleted, setAuthCompleted] = useState(false);

  // Auto-submit the auth form via fetch to complete captive portal authentication.
  // Using fetch instead of form.submit() intercepts the redirect to '/' so the
  // portal UI stays visible — the user is not kicked out and can view their balance.
  // Internet access was already granted by the payment POST in submitToken(); this
  // GET request finalises the captive portal detection flow without navigating away.
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch('/', { method: 'GET' })
        .then(() => setAuthCompleted(true))
        .catch(() => setAuthCompleted(true)); // proceed regardless — auth already granted
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  // build the persistent portal balance URL from the gateway host
  const balanceUrl = `${getTollgateBaseUrl()}/portal`;

  return <div className="tollgate-captive-portal-access-granted">
    <div className="tollgate-captive-portal-access-granted-checkmark">
      <AccessGrantedIcon />
    </div>
    <div className="tollgate-captive-portal-access-granted-label">
      <h2>{t('access_granted_title')}</h2>
      <p dangerouslySetInnerHTML={{ __html: t('access_granted_subtitle', { purchased: `<strong>${allocation}</strong>` }) }}></p>

      {/* show the access duration the user purchased */}
      <div className="tollgate-captive-portal-access-granted-duration">
        <span className="tollgate-captive-portal-access-granted-duration-label">
          {t('access_duration_label')}
        </span>
        <span className="tollgate-captive-portal-access-granted-duration-value">
          {allocation}
        </span>
      </div>

      {/* link to the persistent balance page so the user can return later */}
      <a
        href={balanceUrl}
        target="_blank"
        rel="noreferrer"
        className="cta tollgate-captive-portal-access-granted-balance-link"
      >
        {t('view_balance')}
      </a>
      <p className="small">{t('balance_link_hint')}</p>
    </div>
  </div>
}

// footer component below container
export const Footer = () => {
  return <div className="tollgate-captive-portal-footer">
    <p><Trans i18nKey="powered_by" components={{ 1: <a href="https://tollgate.me/" target="_blank" rel="noreferrer"></a> }} /></p>
  </div>
}

// mint access options component
export const AccessOptions = ({ pricingInfo, selectedMint, setSelectedMint }) => {
  const { t } = useTranslation();
  return <>
    {/* render a button for each available mint option */}
    {pricingInfo.length > 0 && pricingInfo.map(mint => {
      if (!mint.price || !mint.url) return null;
      let mintAddressStripped = mint.url.replace('https://', '');
      mintAddressStripped = mintAddressStripped.replace('http://', '');

      const stepSizeInfo = getStepSizeValues(mint, t);
      const formattedStepSize = stepSizeInfo ? `${stepSizeInfo.value} ${stepSizeInfo.unit}` : "[step_size_formatted]";
      const pricePerStep = mint.price / (mint.min_steps || 1);
      let mintPriceFormatted = `${pricePerStep.toFixed((pricePerStep % 1 !== 0) ? 2 : 0)} ${mint.unit} / ${formattedStepSize}`;

      return <button
        key={mintAddressStripped}
        className={classNames('ghost', 'ellipsis', { 'cta active': mint.url === selectedMint.url })}
        onClick={() => {
          setSelectedMint(mint);
        }}>
        <span className="mint-price ellipsis">
          <RadioButtonIcon />
          {mint.price} {mint.unit}
        </span>
        <span className="mint-meta">
          <span className="mint-meta-address">{mintAddressStripped}</span>
          <span className="mint-meta-price-per-step">{mintPriceFormatted}</span>
        </span>
      </button>
    })}
  </>
}

export default App