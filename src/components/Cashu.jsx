// external
import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';

// internal
import LanguageSwitcher from './LanguageSwitcher';
import DeviceInfo from './DeviceInfo';
import { Error, Success } from './Status';
import { Processing, AccessGranted, AccessOptions } from '../App'
import { CancelIcon } from './Icon'

// helpers
import { requestScanQr } from '../helpers/qr-code';
import { requestPaste } from '../helpers/clipboard';
import { getAccessOptions, calculateAllocation } from '../helpers/tollgate';
import { validateToken, submitToken } from '../helpers/cashu';

// styles and assets
import './Cashu.scss'

// main component for cashu payment method
export const Cashu = (props) => {
  const { t } = useTranslation();
  const { tollgateDetails } = props;
  // state for user input and payment flow
  const [token, setToken] = useState('');
  const [tokenValue, setTokenValue] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [accessOptions, setAccessOptions] = useState([])
  const [allocation, setAllocation] = useState(null)
  const [selectedMint, setSelectedMint] = useState(null)

  // set access options if tollgate details are set
  useEffect(() => {
    const options = getAccessOptions(tollgateDetails.detailsEvent, t);
    if (options.length) {
      setAccessOptions(options);
      setSelectedMint(options[0])
      // for development purposes
      // setTimeout(() => {
      //   // 420 stats
      //   // setToken('cashuBpGFteCJodHRwczovL25vZmVlcy50ZXN0bnV0LmNhc2h1LnNwYWNlYXVjc2F0YXSBomFpSAC0zSfYhhpEYXCEpGFhBGFzeF9bIlAyUEsiLHsibm9uY2UiOiI0N2Y4Y2IyYTFiYWY5ZjhkYzQ4ZDI4ZTNiMGUzODhmY2UxYmZiOTVlZjAwODE3MTg4YzkzMTU0NGMyMzJmN2ZjIiwidGFncyI6W119XWFjWCED_Eg3DCumAWtmUlJX-wQL5VMW_uTNyHKfg-K1QapLVahhZKNhZVgg5gGQFjN9-1b_jqKJgbaY4-dhmBYr5UqqUxuxqRLPUzJhc1ggaCiCFnmqkZ02PJJhVJ-vM-_9WtePRDt5cPBlST0wmORhclggE3wqT6NrH2QzGfO_MQ4jTnO59Mc2cr2KGY6vjnohKt2kYWEYIGFzeF9bIlAyUEsiLHsibm9uY2UiOiJmNjdlOWJkNmNkMThiMmI2YjQyM2U3YmU4NWRmMjUxNWU4ZGQyYWU1NzVlYTE3ZTM3YmVkNDc4MjQzZDFjMzlmIiwidGFncyI6W119XWFjWCECWcB712IIHW3sq2emd8eNAZIKUt3SAzOwpAK1CZsZ_k1hZKNhZVggBusKAQ7SDmxNBDhqt1veoTXo4Hdexjq3y-xPQoEwjtdhc1ggdHlFY6ILItNbP87l45KxFuQZb1DPRnFXz9XBkbmcQf5hclgga9odUX_scqsK_9fXhgGgwVR12-z1XBzMIGlsW7Y-B3ykYWEYgGFzeF9bIlAyUEsiLHsibm9uY2UiOiI1YTdjZmM3Mzg0MTQyYjY3Y2I1N2VlMThiOGE3NjIyODgyNTg5YTkwZjYxM2RhZDg1YjM1YzgwNjVmZWFhNTk1IiwidGFncyI6W119XWFjWCECqvNa-Cq7SE2F-X9kmX6BoE_6hdPpziwH7ucvq85dnAhhZKNhZVgguzfdpxik53NXvzJKapvLDg4p_US26WHY7pASwxpF5vxhc1ggD2ZmSOU6LscrWKIJaOvo-2jeWlVeHJXxKWabm9v9NWVhclgglhPmxos7-GuHsRff6dTfdoonXTtZPb96DkmZOqNi2wykYWEZAQBhc3hfWyJQMlBLIix7Im5vbmNlIjoiODE2Y2EwMWFhNGEzOGY5MzYyZmZiNmZlODkzZTlmZTdkZDVmYTRlZmM0MTM4YmVhZGRhMzRhNTEwYzg3ODhkYyIsInRhZ3MiOltdfV1hY1ghA3upuHXYkvqVhg5QMihMwBUuGX71aAeOQaN-8o0rHxHqYWSjYWVYINp6jhzIGN4Vn45g96IzXRm6PNO0C66C3Tpk-g1EpKNuYXNYIFDsqRFfC252PT3HyoNv9siolqEdulhBM3JlMouo-1uOYXJYIIanZZV-SoXRk30n67Wce5a1UiCZfbtl3wtmaaye2YzAYWRyU2VudCBmcm9tIE1pbmliaXRz')
      //   // 500 sats
      //   setToken('cashuBpGFteCJodHRwczovL25vZmVlcy50ZXN0bnV0LmNhc2h1LnNwYWNlYXVjc2F0YXSBomFpSAC0zSfYhhpEYXCGpGFhBGFzeF9bIlAyUEsiLHsibm9uY2UiOiIzZTI4YmU0MzU5ZTU3YmFhZjg4MWU3MjFjMTczZjllYTc3MzdhYjY4NTNiZTNiYWNmNzlkZWVjNTBkMGE2NmJiIiwidGFncyI6W119XWFjWCEDYX_NDs7lJ5ME1QRmNOOfG74uqyhZstpvi8fSNmgD3_RhZKNhZVgg1DvKE44nwiXNkEuzPEZmQo981Fjt9CbCrSGNqyNb6YZhc1gglZ_LS6EIh2UXwSwXan74plrWobFwKd5B0ZCAEitykp9hclggU3dfURvYljMwAzkok0bydeL0cx185l3ii75g0lIjvdykYWEQYXN4X1siUDJQSyIseyJub25jZSI6ImNjMmE1MDBkNjY5MjM2MjdlODUwYzEyYTEzMzBkZDA3ZmZmZjE5ZTMyYTM2NzgyMTYzNzlhYWE0ZTZkMzNjNWIiLCJ0YWdzIjpbXX1dYWNYIQNR2xKIkIYD85Igp0irRDs_VfIpL6YWHiR4IeE4r4CiLmFko2FlWCD0IbUHh92RYb7atlK6KSfhlMi4FZK0zodvolQPCqJOv2FzWCBgHvnnh6ajb7cHKUzh4XNp2xlCm2r2tbzejnxMH8X6g2FyWCBxNYafLyZQTeMMVAlfWHIMQEHMjZpXKnOD6YgBZ1_XUKRhYRggYXN4X1siUDJQSyIseyJub25jZSI6Ijc2MDUxNTY0N2ViNWRiMzQ5YjE3MjFkNDI1ODVjNzVjZDUwMjJiODA5YzFmYjI4MTAwYmVjZGRlODRjOTNmOTgiLCJ0YWdzIjpbXX1dYWNYIQOi8yLO3wF2lR__zCaGZMP7DyGuDjEbwqgEkNIUIeLmRmFko2FlWCBssG6Ls2926KzfFhmghNO1R2SKdGtgi_uxukxwHArlaWFzWCCXfdSh8bZgPiCVDsMrOppeF1RJcpj0BHHI9FDGOXRBbGFyWCD05op33Q4PJqEWkzm65-KYgMTJerihHULGbd1uJgMjtKRhYRhAYXN4X1siUDJQSyIseyJub25jZSI6IjQ4ZTkwMThiMjZlYWRlODUxOTBjNDFhNjg5NjkzNDg3NTk5OTJiNGI4Yjg3ZjgxZWYzMzIwNDM2MTEyMDJlMmUiLCJ0YWdzIjpbXX1dYWNYIQOi1lUMkBc_BCvwFahjs8Ujx99DhBTSEz1ZLB-2btwPn2Fko2FlWCDcRnhCaygRcj12EGreGtTadlxAMLKMM26ZOQ1mYBnsRmFzWCA7VHqQn20Q30c0Vq9lb4XVs75PAHm-sGoFUuDSZgnV42FyWCBDieBgjAJCL39D5LokRJRNc3ElYGTEzlv1dSoNzdlTfKRhYRiAYXN4X1siUDJQSyIseyJub25jZSI6IjEzNzgyMGJhZDA1YWQxNzEwYzc0Y2FhY2E2ZjIwZjI2NDliYTdkNzI4OWVlMDlhMDM2NjU2ZTc1NGJhNGVjYWMiLCJ0YWdzIjpbXX1dYWNYIQIUcuSRSCHamPK8ttt9P2Puo7U_Gst_oHeKf59s4NQ7VmFko2FlWCA0RQL68DDP_j92DFbjKh35tBzufz3IGiz-MdHd2Hc7zGFzWCCtFOzMxl7s6MfvA4r7OGe27RWMUpx7PjFe2meGEkiL8mFyWCC79zIIfW5KWz5BHHs8ySQUDPs0XKZqwhDT034EfE6EuKRhYRkBAGFzeF9bIlAyUEsiLHsibm9uY2UiOiJhYzE3NGQ1NDU5YzE4ZTVlMGQ3MzJkMzFkNDM0MGQ5NmUwZGYxNDM5MDdlN2I5NTI5ZWJkNDU0NjUyNjQxNDNlIiwidGFncyI6W119XWFjWCECa3ivvcTBKbj-wJQ4fULdwLwejRZtI4bFiX6wSugpaxZhZKNhZVggHHFxUObcKD5PX7h3Tk6l-2lMHI4LOvLu8zRlInnJBwFhc1gg-ZGy0lfb7Y56GO5dGPb4foC0OAGuK-TEAVwnkCRp_vlhclggDthWR3ozZKIETGaVwImPWcRCfcddMN3McAJVqTdfUCRhZHJTZW50IGZyb20gTWluaWJpdHM')
      // }, 100)
    } else {
      setError({
        status: 0,
        code: 'CU001',
        label: t('CU001_label'),
        message: t('CU001_message')
      })
    }
  }, [tollgateDetails])

  // handle token change: validate and calculate allocation
  useEffect(() => {
    if (token) {
      const validation = validateToken(token, selectedMint, t);
      if (!validation.status) {
        setError(validation)
        setTokenValue(null)
      } else {
        setTokenValue(validation.value)
        setAllocation(calculateAllocation(validation.value.amount, selectedMint, t))
        if (validation.value.amount < selectedMint.price) {
          setError({
            status: 0,
            code: 'CU002',
            label: t('CU002_label'),
            message: t('CU002_message')
          })
        } else {
          setError(null)
        }
      }
    } else {
      setTokenValue(null)
      setAllocation(null)
      setError(null)
    }
  }, [token])

  // handle mint change: recalculate allocation and error
  useEffect(() => {
    if (selectedMint && tokenValue && tokenValue.amount) {
      if (tokenValue.amount < selectedMint.price) {
        setError({
          status: 0,
          code: 'CU002',
          label: t('CU002_label'),
          message: t('CU002_message')
        })
      } else {
        setError(null);
      }
      setAllocation(calculateAllocation(tokenValue.amount, selectedMint, t))
    }
  }, [selectedMint])

  // handle processing state: submit token and handle result
  useEffect(() => {
    if (processing) {
      const submit = async () => {
        const response = await submitToken(token, tollgateDetails, allocation, t);
        setProcessing(false);

        if (response.status) {
          setSuccess(true);
          // try to auto-close the page after 3 seconds
          setTimeout(() => {
            window.close();
          }, 3000);
        } else {
          setError(response)
        }
      }

      submit()
    }
  }, [processing])

  // render the cashu payment form and flow
  return (
    <div className="tollgate-captive-portal-method-cashu tollgate-captive-portal-method">
      {/* header: shows the portal title and a short description about cashu */}
      {(!success && !processing) && <Header />}

      <div className="tollgate-captive-portal-method-content">
        {/* processing: displays a loading indicator and message while payment is being processed */}
        {(!success && processing) && <Processing label={t('processing_payment')} />}

        {/* accessgranted: shows a success message and the amount of access granted after a successful payment */}
        {(success && !processing) && <AccessGranted allocation={`${allocation.value} ${allocation.unit}`} />}

        {/* tokeninput: input field and actions for entering or scanning a cashu token */}
        {(!success && !processing && accessOptions.length) && <TokenInput token={token} setToken={setToken} scanning={scanning} setScanning={setScanning} setError={setError} />}

        {/* success: displays a message when a valid cashu token is detected, before purchase */}
        {(!success && !processing && tokenValue) && <Success 
          label={t('valid_cashu_token')} 
          info={tokenValue.amount !== 1 ? t('sat_plural', { count: tokenValue.amount }) : t('sat', { count: tokenValue.amount })}
          message={t('valid_cashu_token_message', { purchased: `${allocation.value} ${allocation.unit}` })}
        />}

        {/* error: shows error messages for invalid tokens or other issues */}
        {error && <Error label={error.label} code={error.code} message={error.message} />}

        {/* accessoptions: lets the user select from available access/pricing options */}
        {(!success && !processing && accessOptions.length) && <div className="tollgate-captive-portal-method-options">
          <h5>{t('access_options')}</h5>
          <AccessOptions 
            pricingInfo={accessOptions} 
            selectedMint={selectedMint} 
            setSelectedMint={setSelectedMint}
          />
        </div>}

        {/* purchase button: only enabled if token is valid and no error */}
        {!success && !processing && <div className="tollgate-captive-portal-method-submit">
          {(!tokenValue || error) && <button disabled>{t('purchase')}</button>}
          {(tokenValue && !processing && !error) && (() => {
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

// cashu header component
const Header = () => {
  const { t } = useTranslation();
  return <div className="tollgate-captive-portal-method-header">
    <h1>{t('portal_title')}</h1>
    <h2><Trans i18nKey="provide_cashu" components={{ 1: <a href="https://cashu.space/" target="_blank" rel="noreferrer"></a> }} /></h2>
  </div>
}

// token input component for entering or scanning a cashu token
const TokenInput = ({ token, setToken, scanning, setScanning, setError }) => {
  const { t } = useTranslation();
  return (
    <div className="tollgate-captive-portal-method-input">
      <input 
        value={token} 
        placeholder={t('cashu_input_placeholder')} 
        type="text" 
        id="cashu-token" 
        onChange={(e) => setToken(e.target.value)}
      ></input>
      <div className="tollgate-captive-portal-method-input-actions">
        {token.length ? <>
          {/* reset button to clear the input */}
          <button className="small cancel" onClick={() => {
            setToken('')
          }}><CancelIcon/></button>
        </> : <>
          {/* paste from clipboard button */}
          <button className="ghost cta small ellipsis" onClick={async (input) => {
            const paste = await requestPaste(t);
            if(paste.status) {
              setToken(paste.value)
            } else {
              setError(paste)
            }
          }}>{t('paste')}</button>
          {/* scan qr code button */}
          <button className="ghost cta small ellipsis" onClick={async () => {
            if (scanning) return;
            setScanning(true);
            const response = await requestScanQr(t);
            if(response.status) {
              setToken(response.value)
            } else {
              // check the code as we can receive 0 which means no error needed
              if (response.code) {
                setError(response)
              }
            }
            setScanning(false);
          }} disabled={scanning}>
            {scanning ? t('scanning') : t('scan_qr')}
          </button>
        </>}
      </div>
    </div>
  )
}

export default Cashu