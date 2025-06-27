import { useState, useRef, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import Background from './components/Background.jsx'
import Cashu from './components/Cashu.jsx'
import Lightning from './components/Lightning.jsx'
import { Error } from './components/Status.jsx';

import { fetchTollgateData } from './helpers/tollgate.js'

import './App.scss'

// Import the TollGate logos
import logoWhite from './assets/logo/TollGate_Logo-C-white.png';

export const App = () => {
  const { t: i18n, i18n: i18n_ } = useTranslation();
  const [method, setMethod] = useState('cashu');
  const [tollgateDetails, setTollgateDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const retryIntervalRef = useRef(null);

  // Initial data fetch on mount
  useEffect(() => {
    const initialFetch = async () => {
      setLoading(true);
      const response = await fetchTollgateData();
      
      if (!response.status) {
        setRetrying(true);
        setError(response);
      } else {
        setTollgateDetails(response);
      }
      
      setLoading(false);
    };
    
    initialFetch();
    
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
      const response = await fetchTollgateData();
      
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

  return <div id="tollgate-captive-portal" className="tollgate-captive-portal">
    <Background />
    <div className="tollgate-captive-portal-interface">
      <div className="tollgate-captive-portal-header">
        <img src={logoWhite} alt="TollGate Logo"></img>
      </div>
      <div className="tollgate-captive-portal-content">
        <div className="tollgate-captive-portal-content-container">
          <div className="tollgate-captive-portal-tabs" aria-label="Tab Navigation">
            <button 
              onClick={() => setMethod('cashu')}
              data-active={method === 'cashu'}
              className="tollgate-captive-portal-tabs-tab tollgate-captive-portal-tabs-tab-cashu ellipsis" 
              label={i18n('cashu_tab')} 
              id="tab-cashu" 
              aria-controls="tab-cashu">
              {i18n('cashu_tab')}
            </button>
            <button 
              onClick={() => setMethod('lightning')}
              data-active={method === 'lightning'}
              className="tollgate-captive-portal-tabs-tab tollgate-captive-portal-tabs-tab-lightning ellipsis" 
              label={i18n('lightning_tab')} 
              id="tab-lightning" 
              aria-controls="tab-lightning">
              {i18n('lightning_tab')}
            </button>
          </div>

          <div className="tollgate-captive-portal-view">
            {loading && <div className="tollgate-captive-portal-loading">
              <span className="spinner big"></span>
              Loading
            </div>}

            {!loading && error && <div className="tollgate-captive-portal-error">
              <Error label={error.label} code={error.code} message={error.message} />
            </div>}

            {!loading && !error && method === 'cashu' && <Cashu tollgateDetails={tollgateDetails.value} />}
            {!loading && !error && method === 'lightning' && <Lightning tollgateDetails={tollgateDetails.value} />}
          </div>

        </div>
      </div>
      <div className="tollgate-captive-portal-footer">
        <p><Trans i18nKey="powered_by" components={{ 1: <a href="https://tollgate.me/" target="_blank" rel="noreferrer"></a> }} /></p>
      </div>
    </div>
  </div>;
}

export default App