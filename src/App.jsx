// external
import { useState, useRef, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import classNames from 'classnames';

// internal
import Background from './components/Background.jsx'
import Cashu from './components/Cashu.jsx'
import Lightning from './components/Lightning.jsx'
import { Error } from './components/Status.jsx';
import { AccessGrantedIcon, RadioButtonIcon } from './components/Icon.jsx'

// helpers
import { fetchTollgateData, getStepSizeValues } from './helpers/tollgate.js'

// styles and assets
import './App.scss'

// Import the TollGate logos
import logoWhite from './assets/logo/TollGate_Logo-C-white.png';

export const App = () => {
  const { t } = useTranslation();
  const [method, setMethod] = useState('cashu');
  const [tollgateDetails, setTollgateDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const retryIntervalRef = useRef(null);

  // Initial data fetch on mount
  useEffect(() => {
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
    
    // Cleanup on unmount
    return () => {
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
      }
    };
  }, []);
  
  // Set up retry mechanism when there's an error
  useEffect(() => {
    // Only set up retry if there's an error and no existing retry interval
    if (!error || tollgateDetails || retryIntervalRef.current) {
      return;
    }
    
    console.log('Setting up retry interval for TollGate details');
    setRetrying(true);
    
    // Set up the retry interval
    retryIntervalRef.current = setInterval(async () => {
      console.log('Retrying to fetch TollGate details...');
      const response = await fetchTollgateData(t);
      
      // If successful, clear the interval
      if (response.status) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
        setTollgateDetails(response);
        setRetrying(false);
        setError(false);
      }
    }, 5000);
    
    // Cleanup function
    return () => {
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
    };
  }, [error, tollgateDetails]);

  // console.log(tollgateDetails);

  return (
    <div id="tollgate-captive-portal" className="tollgate-captive-portal">
      <Background />

      <div className="tollgate-captive-portal-interface">
        <Header />

        <div className="tollgate-captive-portal-content">
          <div className="tollgate-captive-portal-content-container">

            <div className="tollgate-captive-portal-tabs" aria-label={t('tab_aria_label')}>
              <Tab type="cashu" method={method} setMethod={setMethod} />
              <Tab type="lightning" method={method} setMethod={setMethod} />
            </div>

            <div className="tollgate-captive-portal-view">
              {loading && <Loading />}

              {!loading && error && <div className="tollgate-captive-portal-error">
                <Error label={error.label} code={error.code} message={error.message} />
              </div>}

              {!loading && !error && method === 'cashu' && <Cashu tollgateDetails={tollgateDetails.value} />}
              {!loading && !error && method === 'lightning' && <Lightning tollgateDetails={tollgateDetails.value} />}
            </div>

          </div>
        </div>

        <Footer />
      </div>

    </div>
  );
}

const Header = () => {
  const { t } = useTranslation();

  return <div className="tollgate-captive-portal-header">
    <img src={logoWhite} alt={t('header_image_alt')}></img>
  </div>
}

const Tab = ({ type, method, setMethod }) => {
  const { t } = useTranslation();

  return <button 
    onClick={() => setMethod(type)}
    data-active={method === type}
    className={`tollgate-captive-portal-tabs-tab tollgate-captive-portal-tabs-tab-${type} ellipsis`} 
    label={t(`${type}_tab`)} 
    id={`tab-${type}`}
    aria-controls={`tab-${type}`}>
    {t(`${type}_tab`)}
  </button>
}

export const Loading = () => {
  const { t } = useTranslation();

  return <div className="tollgate-captive-portal-loading">
    <span className="spinner big"></span>
    {t('loading')}
  </div>
}

export const Processing = ({ label }) => {
  const { t } = useTranslation();

  if (!label || "string" !== typeof label || !label.length) label = t('processing')

  return <div className="tollgate-captive-portal-processing">
    <span className="spinner big"></span>
    {label}
  </div>
}

export const AccessGranted = ({ allocation }) => {
  const { t } = useTranslation();

  return <div className="tollgate-captive-portal-access-granted">
    <div className="tollgate-captive-portal-access-granted-checkmark">
      <AccessGrantedIcon />
    </div>
    <div className="tollgate-captive-portal-access-granted-label">
      <h2>{t('access_granted_title')}</h2>
      <p dangerouslySetInnerHTML={{__html: t('access_granted_subtitle', { purchased: `<strong>${allocation}</strong>` })}}></p>
    </div>
  </div>
}

const Footer = () => {
  return <div className="tollgate-captive-portal-footer">
    <p><Trans i18nKey="powered_by" components={{ 1: <a href="https://tollgate.me/" target="_blank" rel="noreferrer"></a> }} /></p>
  </div>
}

export const AccessOptions = ({ pricingInfo, selectedMint, setSelectedMint }) => {
  const { t } = useTranslation();
  return <>
    {pricingInfo.length && pricingInfo.map(mint => {
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