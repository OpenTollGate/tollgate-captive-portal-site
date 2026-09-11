// external
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// internal
import LanguageSwitcher from './LanguageSwitcher';
import DeviceInfo from './DeviceInfo';
import { Error } from './Status';
import { SuccessIcon, CancelIcon } from './Icon';

// helpers
import { requestScanQr, hasCameraSupport } from '../helpers/qr-code';
import { requestPaste } from '../helpers/clipboard';
import { getAccessOptions, getStepSizeValues } from '../helpers/tollgate';
import { getInternetBalance, formatBalance } from '../helpers/balance';

// styles and assets
import './BalancePage.scss';

// Balance page: shows the user's "internet balance" — the time/bytes a Cashu
// token grants against the tollgate's pricing. Read-only (no purchase); the
// "Purchase Internet Access" link hands off to the Cashu flow via onNavigate.
//
// This component is intentionally self-contained so it can be reached both as
// a standalone nav target (the "Balance" tab in App.jsx) AND reused as a step
// in a future first-run config wizard (it only needs tollgateDetails + an
// optional onNavigate callback).
export const BalancePage = (props) => {
  const { t } = useTranslation();
  const { tollgateDetails, onNavigate } = props;

  // user input + derived balance state
  const [token, setToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const [balance, setBalance] = useState(null); // { amount, unit, allocation }
  const [error, setError] = useState(null);
  const [mint, setMint] = useState(null);

  // resolve the default (best) mint + step info from the tollgate details
  useEffect(() => {
    const options = getAccessOptions(tollgateDetails.detailsEvent, t);
    if (options.length) {
      setMint(options[0]);
    }
  }, [tollgateDetails]);

  // recompute the balance whenever the token or mint changes
  useEffect(() => {
    if (!token || !mint) {
      setBalance(null);
      setError(null);
      return;
    }
    const result = getInternetBalance(token, mint, t);
    if (!result.status) {
      setBalance(null);
      setError(result);
    } else {
      setBalance(result.value);
      setError(null);
    }
  }, [token, mint]);

  const stepSize = mint ? getStepSizeValues(mint, t) : null;

  // render the balance lookup UI and the prominent balance display
  return (
    <div className="tollgate-captive-portal-method tollgate-captive-portal-balance">
      <div className="tollgate-captive-portal-method-header">
        <h1>{t('balance_page_title')}</h1>
        <h2>{t('balance_page_subtitle')}</h2>
      </div>

      <div className="tollgate-captive-portal-method-content">
        {/* token input: paste or scan a cashu token to look up its balance */}
        <div className="tollgate-captive-portal-method-input">
          <input
            value={token}
            placeholder={t('balance_input_placeholder')}
            type="text"
            id="balance-token"
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="tollgate-captive-portal-method-input-actions">
            {token.length ? (
              <button className="small cancel" onClick={() => setToken('')} aria-label={t('cancel')}>
                <CancelIcon />
              </button>
            ) : (
              <>
                {/* paste from clipboard */}
                <button className="ghost cta small ellipsis" onClick={async () => {
                  const paste = await requestPaste(t);
                  if (paste.status) {
                    setToken(paste.value);
                  } else {
                    setError(paste);
                  }
                }}>{t('paste')}</button>
                {/* scan qr code — only shown when the camera API is usable
                    (requires a secure context). On plain HTTP the paste
                    button above remains the way to enter a token. */}
                {hasCameraSupport() && <button className="ghost cta small ellipsis" onClick={async () => {
                  if (scanning) return;
                  setScanning(true);
                  const response = await requestScanQr(t);
                  if (response.status) {
                    setToken(response.value);
                  } else if (response.code) {
                    setError(response);
                  }
                  setScanning(false);
                }} disabled={scanning}>
                  {scanning ? t('scanning') : t('scan_qr')}
                </button>}
              </>
            )}
          </div>
        </div>

        {/* the balance DISPLAY.
            DESIGN-2: the header has its top-left and top-right corners rounded
            (see BalancePage.scss .balance-display-header); the bottom corners
            stay square, giving the card a clear header/content split. */}
        <div className="balance-display" data-state={balance ? 'filled' : 'empty'}>
          <div className="balance-display-header">
            <p className="balance-display-label">
              <SuccessIcon />
              {t('balance_label')}
            </p>
            <p className="balance-display-amount">
              {balance ? formatBalance(balance.allocation) : '—'}
            </p>
          </div>
          <div className="balance-display-content">
            {balance ? (
              <p dangerouslySetInnerHTML={{ __html: t('balance_summary', {
                token: `<strong>${balance.amount} ${balance.unit}</strong>`,
                access: `<strong>${formatBalance(balance.allocation)}</strong>`
              }) }} />
            ) : (
              <p className="muted">{t('balance_empty')}</p>
            )}
            {mint && stepSize && (
              <p className="muted small">
                {t('balance_rate', { price: mint.price, unit: mint.unit, step: `${stepSize.value} ${stepSize.unit}` })}
              </p>
            )}
          </div>
        </div>

        {/* error: invalid token / read failures */}
        {error && <Error label={error.label} code={error.code} message={error.message} />}

        {/* nav link back to the purchase flow (easy round-trip) */}
        {onNavigate && (
          <div className="tollgate-captive-portal-method-submit">
            <button className="cta" onClick={() => onNavigate('cashu')}>
              {t('balance_go_purchase')}
            </button>
          </div>
        )}
      </div>

      <div className="tollgate-captive-portal-method-footer">
        <DeviceInfo tollgateDetails={tollgateDetails} />
        <LanguageSwitcher />
      </div>
    </div>
  );
};

export default BalancePage;
