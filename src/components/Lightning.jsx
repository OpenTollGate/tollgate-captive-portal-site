// external
import React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import classNames from 'classnames';

// internal
import LanguageSwitcher from './LanguageSwitcher';
import DeviceInfo from './DeviceInfo';
import { Error, Success } from './Status';
import { Processing, AccessGranted, AccessOptions } from '../App'
import { CancelIcon, SwitchIcon } from './Icon'

// helpers
import { getAccessOptions, calculateAllocation } from '../helpers/tollgate';
import { requestInvoice } from '../helpers/lightning';
import { createQr } from '../helpers/qr-code';
import { copyTextToClipboard } from '../helpers/clipboard';

// styles and assets
import './Lightning.scss'

export const Lightning = (props) => {
  const { t } = useTranslation();
  const { tollgateDetails } = props;
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [accessOptions, setAccessOptions] = useState([])
  const [selectedMint, setSelectedMint] = useState(null)
  const [unitAmount, setUnitAmount] = useState('')
  const [allocation, setAllocation] = useState(null)
  const [invoice, setInvoice] = useState(null);

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

  // handle unitAmount change
  useEffect(() => {
    if (unitAmount) {
      setAllocation(calculateAllocation(unitAmount, selectedMint, t))
      if (unitAmount < selectedMint.price) {
        setError({
          status: 0,
          code: 'LN04',
          label: 'Not enough funds',
          message: 'The specified amount  does not provide enough funds for the selected mint.'
        })
      } else {
        setError(null)
      }
    } else {
      setAllocation(null)
      setError(null)
    }
  }, [unitAmount])

  // handle mint change
  useEffect(() => {
    if (selectedMint) {
      setUnitAmount(selectedMint.price)
    }
  }, [selectedMint])

    // handle processing change
    useEffect(() => {
      if (processing && !invoice) {
        const request = async () => {
          const response = await requestInvoice(unitAmount, tollgateDetails.deviceInfo, t);
          
          setTimeout(() => {
            setProcessing(false);
            console.log(response)

            if (response.status) {
              setInvoice(response.invoice)
            } else {
              setError(response)
            }
          }, 500)
        }

        request()
      }
    }, [processing])
  
  return <div className="tollgate-captive-portal-method-lightning tollgate-captive-portal-method">
      {((!success && !processing) || (invoice && !success)) && <Header />}

      <div className="tollgate-captive-portal-method-content">
        {(!success && processing) && <Processing label={t('processing_invoice_request')} />}

        {(success && !processing) && <AccessGranted allocation={`${allocation.value} ${allocation.unit}`} />}

        {(!success && !processing && accessOptions.length && !invoice) && <UnitInput 
          pricingInfo={accessOptions} 
          selectedMint={selectedMint}
          unitAmount={unitAmount}
          setUnitAmount={setUnitAmount}
        />}

        {error && <Error label={error.label} code={error.code} message={error.message} />}

        {(!success && !processing && accessOptions.length && !invoice) && <div className="tollgate-captive-portal-method-options">
          <h5>{t('access_options')}</h5>
          <AccessOptions 
            pricingInfo={accessOptions} 
            selectedMint={selectedMint} 
            setSelectedMint={setSelectedMint}
          />
        </div>}

        {!success && !processing && invoice && <div className="tollgate-captive-portal-method-invoice">
          <div className="tollgate-captive-portal-method-invoice-header">
            <span dangerouslySetInnerHTML={{
              __html: 
              selectedMint ? 
              t('purchase_filled', { 
                price: `<strong>${unitAmount} ${selectedMint.unit}</strong>`, 
                unit: `<strong>${allocation.value} ${allocation.unit}</strong>`
              }) : 
              t('purchase')
            }}></span>
            <button onClick={() => {
              setInvoice(null)
            }}><CancelIcon />{t('cancel')}</button>
          </div>
          <a 
            // testing
            onClick={() => {
              setSuccess(true);
            }}
            // href={ invoice.startsWith('lnbc') ? `lightning:${invoice}` : invoice }
            className="tollgate-captive-portal-method-invoice-svg"
            dangerouslySetInnerHTML={{ __html: createQr(invoice) }}
          ></a>
          <div className="tollgate-captive-portal-method-invoice-actions">
            <a 
              // testing
              onClick={() => {
                setSuccess(true);
              }}
              // href={ invoice.startsWith('lnbc') ? `lightning:${invoice}` : invoice }
              className="btn cta ellipsis" 
            >{t('lightning_open_wallet')}</a>
            <button className="cta ellipsis" onClick={(e) => copyTextToClipboard(e, invoice, t)}>{t('clipboard_copy')}</button>
          </div>
        </div>}

        {!success && !processing && !invoice && <div className="tollgate-captive-portal-method-submit">
          {(!unitAmount || error) && <button disabled>{t('purchase')}</button>}
          {(allocation && !processing && !error) && (() => {
            return <button 
              className="cta" 
              dangerouslySetInnerHTML={{
              __html: 
                selectedMint ? 
                t('purchase_filled', { 
                  price: `<strong>${unitAmount} ${selectedMint.unit}</strong>`, 
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
  </div>;
}

const Header = () => {
  const { t } = useTranslation();
  return <div className="tollgate-captive-portal-method-header">
    <h1>{t('portal_title')}</h1>
    <h2><Trans i18nKey="provide_lightning" components={{ 1: <a href="https://en.wikipedia.org/wiki/Lightning_Network" target="_blank" rel="noreferrer"></a> }} /></h2>
  </div>
}

const UnitInput = ({pricingInfo, selectedMint, unitAmount, setUnitAmount}) => {
  const { t } = useTranslation();
  return <div className="tollgate-captive-portal-method-input">
    <input 
      value={unitAmount} 
      placeholder={t('lightning_input_placeholder')} 
      type="text" 
      inputMode="numeric"
      id="lightning-unit-amount" 
      onChange={(e) => {
        if (e.target.value.length) {
          console.log(typeof e.target.value, e.target.value.length, e.target.value)
          // if is a number and not 0
          if (!isNaN(Number(e.target.value)) && Number(e.target.value)) {
            setUnitAmount(Number(e.target.value))
          } else {
            // if it is 0
            if(!isNaN(Number(e.target.value))) {
              setUnitAmount('');
            }
          }
          return;
        }
        // sets the field to '' if backspace
        setUnitAmount('');
      }}
    ></input>
    <div className="tollgate-captive-portal-method-input-actions">
      <button className="small cta ghost" disabled={unitAmount - selectedMint.price < selectedMint.price} onClick={() => {
        setUnitAmount(unitAmount - selectedMint.price)
      }}>–</button>
      <button className="small cta ghost" onClick={() => {
        setUnitAmount(unitAmount + selectedMint.price)
      }}>+</button>
    </div>
  </div>
}

export default Lightning