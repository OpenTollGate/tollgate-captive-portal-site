import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import classNames from 'classnames';

import LanguageSwitcher from './LanguageSwitcher';
import DeviceInfo from './DeviceInfo';
import { Error, Success } from './Status';

import { scanQr } from '../helpers/qr-code';
import { getPricingInfo, formatPricingInfo, calculatePurchasedAllocation } from '../helpers/tollgate';
import { validateToken } from '../helpers/cashu';

import './Cashu.scss'

export const Cashu = (props) => {
  const { tollgateDetails } = props;
  const { t: i18n } = useTranslation();
  const [token, setToken] = useState('');
  const [tokenValue, setTokenValue] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const pricingInfo = getPricingInfo(tollgateDetails.detailsEvent);
  const [selectedMint, setSelectedMint] = useState([])
  const [selectedMintPrice, setSelectedMintPrice] = useState([])

  useEffect(() => {
    setSelectedMint(pricingInfo.mints[0] ? pricingInfo.mints[0][4] : [])
    setSelectedMintPrice(pricingInfo.mints[0] ? pricingInfo.mints[0][2] : 0)
  }, [])

  // handle token change
  useEffect(() => {
    if (!token || !token.length) {
      setError(null);
      setTokenValue(null);
    } else {
      const validation = validateToken(token);
      console.log(validation);
      if (!validation.status) {
        setError(validation);
        setTokenValue(null);
      } else {
        setTokenValue(validation.value);
        setError(null)
      }
    }
  }, [token])

  return <div className="tollgate-captive-portal-method-cashu tollgate-captive-portal-method">

      <div className="tollgate-captive-portal-method-header">
        <h1>{i18n('ssid')}</h1>
        <h2><Trans i18nKey="provide_cashu" components={{ 1: <a href="https://cashu.space/" target="_blank" rel="noreferrer"></a> }} /></h2>
      </div>

      <div className="tollgate-captive-portal-method-content">

        <div className="tollgate-captive-portal-method-input">
          <input 
            value={token} 
            placeholder={i18n('input_placeholder')} 
            type="text" 
            id="cashu-token" 
            onChange={(e) => setToken(e.target.value)}
          ></input>
          <div className="tollgate-captive-portal-method-input-actions">
            {token.length ? <>
              <button className="ghost cta small ellipsis" onClick={() => setToken('')}>×</button>
            </> : <>
              <button className="ghost cta small ellipsis" onClick={async (input) => {
                try {
                  const text = await navigator.clipboard.readText();
                  setToken(text);
                } catch (err) {
                  if (err && err.name && err.name === 'NotAllowedError') {
                    window.alert(i18n('clipboard_permission_denied'));
                  } else {
                    window.alert(i18n('clipboard_failed'));
                  }
                }
              }}>{i18n('paste')}</button>
              <button className="ghost cta small ellipsis" onClick={async () => {
                if (scanning) return;
                setScanning(true);
                try {
                  const qr = await scanQr();
                  setToken(qr);
                } catch (err) {
                  if (err && err.name && err.name === 'NotAllowedError') {
                    window.alert(i18n('camera_permission_denied'));
                  } else {
                    console.log(err);
                    if (!(err && err.message && err.message.includes('cancelled by user'))) {
                      window.alert(i18n('camera_failed'));
                    }
                  }
                } finally {
                  setScanning(false);
                }
              }} disabled={scanning}>
                {scanning ? i18n('scanning') : i18n('scan_qr')}
              </button>
            </>}
          </div>
        </div>

        {tokenValue && <Success 
          label={i18n('valid_cashu_token')} 
          info={tokenValue.amount !== 1 ? i18n('sat_plural', { count: tokenValue.amount }) : i18n('sat', { count: tokenValue.amount })}
          message={i18n('valid_cashu_token_message', { purchased: calculatePurchasedAllocation(tokenValue.amount, pricingInfo.metric, selectedMintPrice, pricingInfo.stepSize, i18n) })}
        />}

        {error && <Error label={error.label} code={error.code} message={error.message} />}

        <div className="tollgate-captive-portal-method-options">
          <h5>{i18n('access_options')}</h5>
          {pricingInfo.mints.map(mint => {
            const mintAddress = mint[4] || false;
            const mintPrice = mint[2] || false;

            if (!mintPrice || !mintAddress) return null;
            let mintAddressStripped = mintAddress.replace('https://', '');
            mintAddressStripped = mintAddressStripped.replace('http://', '');

            let mintPriceFormatted = formatPricingInfo(pricingInfo.metric, mintPrice, pricingInfo.stepSize, i18n);

            return <button 
              key={mintAddressStripped} 
              className={classNames('ghost', 'ellipsis', { 'cta': mint[4] === selectedMint })}
              onClick={() => {
                setSelectedMint(mint[4]);
                setSelectedMintPrice(mint[2]);
              }}>
              <span className="mint-url ellipsis"><span className={classNames('fake-radio', { 'active': mint[4] === selectedMint })}></span>{mintAddressStripped}</span>
              <span className="tollgate-captive-portal-pricing" dangerouslySetInnerHTML={{__html:mintPriceFormatted}}></span>
            </button>
          })}
        </div>

        <div className="tollgate-captive-portal-method-submit">
          {!tokenValue && <button disabled>{i18n('purchase')}</button>}
          {tokenValue && <button className="cta" dangerouslySetInnerHTML={{
            __html: 
              selectedMint ? 
              i18n('purchase_filled', { 
                price: `<strong>${tokenValue.amount !== 1 ? i18n('sat_plural', { count: tokenValue.amount }) : i18n('sat', { count: tokenValue.amount })}</strong>`, 
                unit: `<strong>${calculatePurchasedAllocation(tokenValue.amount, pricingInfo.metric, selectedMintPrice, pricingInfo.stepSize, i18n)}</strong>`
              }) : 
              i18n('purchase')
          }}></button>}
        </div>

      </div>

      <div className="tollgate-captive-portal-method-footer">
        <DeviceInfo tollgateDetails={tollgateDetails} />
        <LanguageSwitcher />
      </div>
  </div>;
}

export default Cashu