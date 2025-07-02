// external
import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import classNames from 'classnames';

// internal
import LanguageSwitcher from './LanguageSwitcher';
import DeviceInfo from './DeviceInfo';
import { Error, Success } from './Status';
import { Processing, AccessGranted } from '../App'

// helpers
import { scanQr } from '../helpers/qr-code';
import { getAccessOptions, getStepSizeValues, calculateAllocation } from '../helpers/tollgate';
import { validateToken, submitToken } from '../helpers/cashu';

// styles and assets
import './Cashu.scss'

// main component
export const Cashu = (props) => {
  const { t } = useTranslation();
  const { tollgateDetails } = props;
  const [token, setToken] = useState('');
  const [tokenValue, setTokenValue] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [accessOptions, setAccessOptions] = useState([])
  const [allocation, setAllocation] = useState(null)
  const [selectedMint, setSelectedMint] = useState(null)

  // set accessoptions if tollgateDetails are set
  useEffect(() => {
    const options = getAccessOptions(tollgateDetails.detailsEvent, t);
    if (options.length) {
      setAccessOptions(options);
      setSelectedMint(options[0]);
    } else {
      setError({
        status: 0,
        code: 'CU01',
        label: 'No access options available',
        message: 'Could not parse TollGate access options.'
      })
    }
  }, [tollgateDetails])

  // handle token change
  useEffect(() => {
    if (token) {
      const validation = validateToken(token, selectedMint, t);
      if (!validation.status) {
        setError(validation)
        setTokenValue(null)
      } else {
        setTokenValue(validation.value)
        setAllocation(calculateAllocation(validation.value, selectedMint, t))
        setError(null)
      }
    } else {
      setTokenValue(null)
      setAllocation(null)
      setError(null)
    }
  }, [token])

  // handle mint change
  useEffect(() => {
    if (selectedMint && tokenValue && tokenValue.amount) {
      setAllocation(calculateAllocation(tokenValue, selectedMint, t))
    }
  }, [selectedMint])

  // handle processing change 
  useEffect(() => {
    if (processing) {
      setTimeout( async () => {
        const response = await submitToken(token, tollgateDetails, allocation, t);
        setProcessing(false);

        if (response.status) {
          setSuccess(true);
          // Try to auto-close the page after 3 seconds
          setTimeout(() => {
            window.close();
          }, 3000);
        } else {
          setError(response)
        }
      }, 2000)
    }
  }, [processing])

  return (
    <div className="tollgate-captive-portal-method-cashu tollgate-captive-portal-method">
      {(!success && !processing) && <Header />}

      <div className="tollgate-captive-portal-method-content">
        {(!success && processing) && <Processing />}

        {(success && !processing) && <AccessGranted allocation={`${allocation.value} ${allocation.unit}`} />}

        {(!success && !processing && accessOptions.length) && <TokenInput token={token} setToken={setToken} scanning={scanning} setScanning={setScanning} setError={setError} />}

        {(!success && !processing && tokenValue) && <Success 
          label={t('valid_cashu_token')} 
          info={tokenValue.amount !== 1 ? t('sat_plural', { count: tokenValue.amount }) : t('sat', { count: tokenValue.amount })}
          message={t('valid_cashu_token_message', { purchased: `${allocation.value} ${allocation.unit}` })}
        />}

        {error && <Error label={error.label} code={error.code} message={error.message} />}

        {(!success && !processing && accessOptions.length) && <div className="tollgate-captive-portal-method-options">
          <h5>{t('access_options')}</h5>
          <AccessOptions 
            pricingInfo={accessOptions} 
            selectedMint={selectedMint} 
            setSelectedMint={setSelectedMint}
          />
        </div>}

        {!success && !processing && <div className="tollgate-captive-portal-method-submit">
          {!tokenValue && <button disabled>{t('purchase')}</button>}
          {(tokenValue && !processing) && (() => {
            return <button 
              className="cta" 
              dangerouslySetInnerHTML={{
              __html: 
                selectedMint ? 
                t('purchase_filled', { 
                  price: `<strong>${tokenValue.amount} ${tokenValue.unit}</strong>`, 
                  unit: `<strong>${allocation.value} ${allocation.unit}</strong>`
                }) : 
                t('purchase')
              }}
              onClick={() => setProcessing(true)} />
          })()}
        </div>}

      </div>

      <div className="tollgate-captive-portal-method-footer">
        <DeviceInfo tollgateDetails={tollgateDetails} />
        <LanguageSwitcher />
      </div>
    </div>
  );
}

const Header = () => {
  const { t } = useTranslation();
  return <div className="tollgate-captive-portal-method-header">
    <h1>{t('portal_title')}</h1>
    <h2><Trans i18nKey="provide_cashu" components={{ 1: <a href="https://cashu.space/" target="_blank" rel="noreferrer"></a> }} /></h2>
  </div>
}

const TokenInput = ({ token, setToken, scanning, setScanning, setError }) => {
  const { t } = useTranslation();
  return (
    <div className="tollgate-captive-portal-method-input">
      <input 
        value={token} 
        placeholder={t('input_placeholder')} 
        type="text" 
        id="cashu-token" 
        onChange={(e) => setToken(e.target.value)}
      ></input>
      <div className="tollgate-captive-portal-method-input-actions">
        {token.length ? <>
          {/* reset */}
          <button className="ghost cta small ellipsis" onClick={() => {
            setToken('')
          }}>×</button>
        </> : <>
          {/* paste from clipboard */}
          <button className="ghost cta small ellipsis" onClick={async (input) => {
            try {
              const text = await navigator.clipboard.readText();
              setToken(text);
            } catch (err) {
              if (err && err.name && err.name === 'NotAllowedError') {
                setError({
                  status: 0,
                  code: 'CB01',
                  label: t('CB01_label'),
                  message: t('CB01_message')
                })
              } else {
                setError({
                  status: 0,
                  code: 'CB02',
                  label: t('CB02_label'),
                  message: t('CB02_message')
                })
              }
            }
          }}>{t('paste')}</button>
          {/* scan qr code */}
          <button className="ghost cta small ellipsis" onClick={async () => {
            if (scanning) return;
            setScanning(true);
            try {
              const qr = await scanQr({}, setError, t);
              console.log(qr)
              if ('string' !== qr && qr.length) {
                setToken(qr)
              } else {
                setError({
                  status: 0,
                  code: 'QR02',
                  label: t('QR02_label'),
                  message: t('QR02_message')
                })
              }
            } catch (err) {
              if (!(err && err.message && err.message.includes('cancelled by user'))) {
                setError({
                  status: 0,
                  code: 'QR02',
                  label: t('QR02_label'),
                  message: t('QR02_message')
                })
              }
            } finally {
              setScanning(false);
            }
          }} disabled={scanning}>
            {scanning ? t('scanning') : t('scan_qr')}
          </button>
        </>}
      </div>
    </div>
  )
}

const AccessOptions = ({ pricingInfo, selectedMint, setSelectedMint }) => {
  const { t } = useTranslation();
  return <>
    {pricingInfo.length && pricingInfo.map(mint => {
      if (!mint.price || !mint.url) return null;
      let mintAddressStripped = mint.url.replace('https://', '');
      mintAddressStripped = mintAddressStripped.replace('http://', '');

      const stepSizeInfo = getStepSizeValues(mint, t);
      const formattedStepSize = stepSizeInfo ? `${stepSizeInfo.value} ${stepSizeInfo.unit}` : "[step_size_formatted]";
      let mintPriceFormatted = `${mint.price} ${mint.unit} / ${formattedStepSize}`;

      return <button 
        key={mintAddressStripped} 
        className={classNames('ghost', 'ellipsis', { 'cta': mint.url === selectedMint.url })}
        onClick={() => {
          setSelectedMint(mint);
        }}>
        <span className="mint-url ellipsis">
          <span className={classNames('fake-radio', { 'active': mint.url === selectedMint.url })}></span>
          {mintAddressStripped}
        </span>
        <span className="tollgate-captive-portal-pricing">{mintPriceFormatted}</span>
      </button>
    })}
  </>
}

export default Cashu