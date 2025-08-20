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
import { createMintProxyClient, addTokensToSession } from '../helpers/mint-proxy';
import { createQr } from '../helpers/qr-code';
import { copyTextToClipboard } from '../helpers/clipboard';

// styles and assets
import './Lightning.scss'

// main component for handling lightning payments
export const Lightning = (props) => {
  const { t } = useTranslation();
  const { tollgateDetails } = props;
  // state for payment flow and user input
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [accessOptions, setAccessOptions] = useState([])
  const [selectedMint, setSelectedMint] = useState(null)
  const [unitAmount, setUnitAmount] = useState('')
  const [allocation, setAllocation] = useState(null)
  const [invoice, setInvoice] = useState(null);
  const [useMintProxy, setUseMintProxy] = useState(true); // Default to mint proxy
  const [mintProxyClient, setMintProxyClient] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [tokens, setTokens] = useState(null);

  // set accessoptions if tollgateDetails are set
  useEffect(() => {
    const options = getAccessOptions(tollgateDetails.detailsEvent, t);
    if (options.length) {
      setAccessOptions(options);
      setSelectedMint(options[0]);
    } else {
      setError({
        status: 0,
        code: 'LN001',
        label: t('LN001_label'),
        message: t('LN001_message')
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
          code: 'LN002',
          label: t('LN002_label'),
          message: t('LN002_message')
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

  // initialize mint proxy client
  useEffect(() => {
    if (useMintProxy && !mintProxyClient && accessOptions.length > 0) {
      try {
        setConnectionStatus('connecting');
        const client = createMintProxyClient();
        
        // Set up event listeners
        client.on('open', () => {
          setConnectionStatus('connected');
          setError(null);
        });
        
        client.on('close', () => {
          setConnectionStatus('disconnected');
        });
        
        client.on('error', (errorData) => {
          setConnectionStatus('error');
          setError({
            status: 0,
            code: errorData.code || 'MP002',
            label: t('connection_error', 'Connection Error'),
            message: errorData.message || t('mint_proxy_connection_failed', 'Failed to connect to mint proxy')
          });
          setProcessing(false);
        });
        
        client.on('invoice_ready', (message) => {
          console.log('Invoice received from mint proxy:', message);
          setInvoice(message.invoice);
          setProcessing(false);
        });
        
        client.on('tokens_ready', (message) => {
          console.log('Tokens received from mint proxy:', message);
          setTokens(message.tokens);
          setInvoice(null);
          
          // Automatically add tokens to session
          handleTokensReceived(message.tokens);
        });
        
        setMintProxyClient(client);
      } catch (error) {
        console.error('Failed to create mint proxy client:', error);
        setConnectionStatus('error');
        setError({
          status: 0,
          code: 'MP003',
          label: t('initialization_error', 'Initialization Error'),
          message: t('mint_proxy_init_failed', 'Failed to initialize mint proxy connection')
        });
      }
    }
    
    // cleanup on unmount or when switching away from mint proxy
    return () => {
      if (mintProxyClient && (!useMintProxy || accessOptions.length === 0)) {
        mintProxyClient.disconnect();
        setMintProxyClient(null);
        setConnectionStatus('disconnected');
      }
    };
  }, [useMintProxy, accessOptions]);

  // handle tokens received from mint proxy
  const handleTokensReceived = async (tokensData) => {
    try {
      setProcessing(true);
      
      // Add tokens to session
      const result = await addTokensToSession(tokensData);
      
      setProcessing(false);
      
      if (result.status) {
        setSuccess(true);
        // auto-close after 3 seconds
        setTimeout(() => {
          window.close();
        }, 3000);
      } else {
        setError({
          status: 0,
          code: result.code || 'MP005',
          label: t('session_error', 'Session Error'),
          message: result.message || t('tokens_session_failed', 'Failed to add tokens to session')
        });
      }
    } catch (error) {
      console.error('Error handling tokens:', error);
      setProcessing(false);
      setError({
        status: 0,
        code: 'MP006',
        label: t('processing_error', 'Processing Error'),
        message: t('tokens_processing_failed', 'Error processing received tokens')
      });
    }
  };

  // handle processing change
  useEffect(() => {
    if (processing && !invoice) {
      const request = async () => {
        if (useMintProxy && mintProxyClient && connectionStatus === 'connected') {
          // Use mint proxy to request invoice
          mintProxyClient.requestInvoice(selectedMint.url, unitAmount);
        } else {
          // Use traditional lightning invoice request
          const response = await requestInvoice(unitAmount, tollgateDetails.deviceInfo, t);

          setTimeout(() => {
            setProcessing(false);
            console.log(response)

            if (response.status) {
              setInvoice(response.invoice)
            } else {
              setError(response)
            }
          }, 500);
        }
      }

      request()
    }
  }, [processing, useMintProxy, mintProxyClient, connectionStatus])

  return <div className="tollgate-captive-portal-method-lightning tollgate-captive-portal-method">
    {/* header: shows the portal title and a short description about lightning */}
    {((!success && !processing) || (invoice && !success)) && <Header useMintProxy={useMintProxy} />}

    <div className="tollgate-captive-portal-method-content">
      {/* processing: displays a loading indicator and message while invoice is being requested */}
      {(!success && processing && !tokens) && <Processing label={useMintProxy ? t('processing_mint_request', 'Requesting invoice from mint...') : t('processing_invoice_request')} />}
      {(!success && processing && tokens) && <Processing label={t('processing_tokens', 'Processing tokens...')} />}

      {/* accessgranted: shows a success message and the amount of access granted after a successful payment */}
      {(success && !processing) && <AccessGranted allocation={`${allocation.value} ${allocation.unit}`} />}

      {/* connection status for mint proxy */}
      {useMintProxy && connectionStatus !== 'connected' && !success && !processing && !invoice && (
        <div className="connection-status">
          <span className="connection-indicator" data-status={connectionStatus}>
            {connectionStatus === 'connecting' ? t('connecting', 'Connecting...') :
             connectionStatus === 'disconnected' ? t('disconnected', 'Disconnected') :
             connectionStatus === 'error' ? t('connection_error', 'Connection Error') :
             t('connected', 'Connected')}
          </span>
        </div>
      )}

      {/* mint proxy toggle */}
      {(!success && !processing && !invoice && accessOptions.length) && (
        <div className="mint-proxy-toggle">
          <label>
            <input
              type="checkbox"
              checked={useMintProxy}
              onChange={(e) => setUseMintProxy(e.target.checked)}
            />
            {t('auto_mint_tokens', 'Automatically mint Cashu tokens')}
          </label>
        </div>
      )}

      {/* unitinput: input field for entering the amount to pay, and selecting access option */}
      {(!success && !processing && accessOptions.length && !invoice && (!useMintProxy || connectionStatus === 'connected')) && <UnitInput
        pricingInfo={accessOptions}
        selectedMint={selectedMint}
        unitAmount={unitAmount}
        setUnitAmount={setUnitAmount}
      />}

      {/* error: shows error messages for invalid input or other issues */}
      {error && <Error label={error.label} code={error.code} message={error.message} />}

      {/* accessoptions: lets the user select from available access/pricing options */}
      {(!success && !processing && accessOptions.length && !invoice && (!useMintProxy || connectionStatus === 'connected')) && <div className="tollgate-captive-portal-method-options">
        <h5>{t('access_options')}</h5>
        <AccessOptions
          pricingInfo={accessOptions}
          selectedMint={selectedMint}
          setSelectedMint={setSelectedMint}
        />
      </div>}

      {/* invoice: shows the lightning invoice as a qr code and provides copy/open actions */}
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

      {/* purchase button: only enabled if amount is valid and no error */}
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
      {/* deviceinfo: shows device and network details for the user */}
      <DeviceInfo tollgateDetails={tollgateDetails} />
      {/* languageswitcher: allows the user to change the ui language */}
      <LanguageSwitcher />
    </div>
  </div>;
}

// lightning header component
const Header = ({ useMintProxy }) => {
  const { t } = useTranslation();
  return <div className="tollgate-captive-portal-method-header">
    <h1>{t('portal_title')}</h1>
    <h2>
      {useMintProxy ?
        t('provide_mint_proxy', 'Pay with Lightning to automatically mint Cashu tokens') :
        (<Trans i18nKey="provide_lightning" components={{ 1: <a href="https://en.wikipedia.org/wiki/Lightning_Network" target="_blank" rel="noreferrer"></a> }} />)
      }
    </h2>
  </div>
}

// lightning unit input component for entering the amount to pay
const UnitInput = ({ pricingInfo, selectedMint, unitAmount, setUnitAmount }) => {
  const { t } = useTranslation();
  return <div className="tollgate-captive-portal-method-input">
    {/* input for entering the amount to pay in the selected unit */}
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
            if (!isNaN(Number(e.target.value))) {
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
      {/* button to decrease the amount by the minimum price */}
      <button className="small cta ghost" disabled={unitAmount - selectedMint.price < selectedMint.price} onClick={() => {
        setUnitAmount(unitAmount - selectedMint.price)
      }}>–</button>
      {/* button to increase the amount by the minimum price */}
      <button className="small cta ghost" onClick={() => {
        setUnitAmount(unitAmount + selectedMint.price)
      }}>+</button>
    </div>
  </div>
}

export default Lightning