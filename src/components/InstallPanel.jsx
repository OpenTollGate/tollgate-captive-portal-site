// The install / first-run panel.
//
// ── The product story, as measured rather than assumed ──────────────────────
//
// The original brief: "the app introduces itself and asks the user to save it to
// the home screen". Measured on the captive-portal origin (SPIKE-secure-
// context.md / WSEC), that instruction cannot be honoured THERE: the origin is
// `http://<router-lan-ip>`, not a secure context, so there is no service worker,
// so Chromium never fires `beforeinstallprompt`, so there is no install prompt
// to raise. A button promising one is a dead control.
//
// So this component renders one of four variants (see helpers/install-ux.js):
//
//   installed — running from a home-screen icon already; nothing to offer
//   prompt    — secure origin + worker: a REAL install button
//   manual    — secure origin, no worker (iOS Safari): Add-to-Home-Screen steps
//   signpost  — insecure origin: explain honestly, deep-link to the vendor app
//
// The panel never throws on the captive-portal origin. `navigator.serviceWorker`
// is ABSENT (not a rejected promise) there, so every capability read goes
// through helpers/pwa-install.js, which branches on `window.isSecureContext`
// first. This component adds no direct feature detection of its own.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildVendorDeepLink,
  currentInstallVariant,
  firstRunShouldShow,
  markInstallDismissed,
  readInstallDismissed,
  readPortalContext,
} from '../helpers/install-ux.js';
import { registrationState, registerServiceWorker } from '../helpers/sw-register.js';

import './InstallPanel.scss';

/**
 * The vendor origin the signpost deep-links to.
 *
 * Empty by default: a self-hosted router does not have a vendor PWA, and a
 * hardcoded third-party origin would be a silent dependency (and would fail the
 * repo's anti-branding gate). A deployment that HAS one sets
 * `VITE_VENDOR_APP_ORIGIN` at build time; without it the signpost renders the
 * manual instructions and no dead link.
 */
const VENDOR_ORIGIN = (import.meta.env && import.meta.env.VITE_VENDOR_APP_ORIGIN) || '';

/** Pick the platform's manual add-to-home-screen wording. */
function manualHintKey() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iPad|iPhone|iPod/.test(ua)) return 'install_signpost_manual_ios';
    if (/Android/.test(ua)) return 'install_signpost_manual_android';
    return 'install_signpost_manual_desktop';
  } catch {
    return 'install_signpost_manual_desktop';
  }
}

export const InstallPanel = ({ variant: variantProp, showFirstRun } = {}) => {
  const { t } = useTranslation();

  const [variant, setVariant] = useState(variantProp || null);
  const [firstRun, setFirstRun] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  // Seed from the STORE, not from false: a customer who dismissed this last
  // visit must not be asked again on the next one. Rendering first and reading
  // storage in an effect would flash the panel on every load.
  const [dismissed, setDismissed] = useState(() => readInstallDismissed());

  // Resolve the variant once, on mount. `currentInstallVariant` is total: it
  // cannot throw and it fails closed to 'signpost'.
  useEffect(() => {
    if (variantProp) return;
    setVariant(currentInstallVariant());
  }, [variantProp]);

  // The first-run intro shows once, and only when it can be acted on.
  useEffect(() => {
    if (showFirstRun === false) return;
    setFirstRun(firstRunShouldShow());
  }, [showFirstRun]);

  // Register the shell worker when this origin can. On the portal origin this
  // resolves to 'unsupported' and changes nothing visible.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // `beforeinstallprompt` can only fire on a secure origin with a worker. The
  // listener is attached unconditionally because attaching it is harmless;
  // actually OFFERING the button is gated on the event arriving, so the UI can
  // never claim a prompt the platform did not raise.
  useEffect(() => {
    if (typeof window === 'undefined' || variant !== 'prompt') return undefined;

    const onPrompt = (event) => {
      // Suppress the browser's own mini-infobar so the in-page panel is the
      // only install affordance — two competing prompts is how a customer
      // dismisses both.
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      setDeferredPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [variant]);

  const dismiss = useCallback(() => {
    markInstallDismissed();
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt || typeof deferredPrompt.prompt !== 'function') return;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      // `dismissed` is a decision, not a failure. Either way the prompt is
      // single-use and cannot be replayed.
      if (choice && choice.outcome === 'accepted') {
        // Accepting IS the answer to the question this panel asks. Recording it
        // in the store alone is not enough: the mounted panel reads its
        // `dismissed` state, not storage, so without this the customer who just
        // installed is shown the add-to-home-screen steps on the very screen
        // that installed them.
        markInstallDismissed();
        setDismissed(true);
      }
    } catch {
      /* a prompt that errors is not worth taking the page down over */
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  if (!variant || dismissed) return null;
  // A signpost has nothing to say to a customer already in the installed app.
  if (variant === 'installed') return null;

  // ── capability vs. what is actually OFFERED ──────────────────────────────
  //
  // `variant` is the origin's CAPABILITY (see chooseInstallVariant). It is not
  // the same question as "what can I put on screen right now". A secure origin
  // with a worker is `prompt`-capable, but Chromium only fires
  // `beforeinstallprompt` once it has decided the app is installable — usually
  // a moment AFTER first paint. Until that event arrives there is no prompt to
  // call, so an install button would be a dead control.
  //
  // So the rendered variant starts at `manual` (real, actionable
  // add-to-home-screen steps) and UPGRADES to `prompt` when the event lands.
  // The capability is still reported separately in `data-capability`, so a
  // debugging session can tell "cannot install" apart from "not offered yet".
  const offered = variant === 'prompt' && !deferredPrompt ? 'manual' : variant;

  const isSignpost = offered === 'signpost';
  const isManual = offered === 'manual';
  const canPrompt = offered === 'prompt';

  // The signpost may deep-link, but only when a vendor origin is configured.
  // `buildVendorDeepLink` throws on a non-https base by design; a bad
  // configuration must not break the page, so it is caught here.
  let deepLink = null;
  if (isSignpost && VENDOR_ORIGIN) {
    try {
      deepLink = buildVendorDeepLink(
        VENDOR_ORIGIN,
        readPortalContext(typeof window !== 'undefined' ? window.location.search : '')
      );
    } catch {
      deepLink = null;
    }
  }

  const title = firstRun && !isSignpost ? 'install_app_title' : 'install_signpost_title';

  return (
    <aside
      className={`install-panel install-panel--${offered}`}
      data-testid="install-panel"
      data-variant={offered}
      data-capability={variant}
      data-first-run={firstRun ? 'true' : 'false'}
      data-sw-state={registrationState()}
      aria-label={t('install_signpost_title')}
    >
      <div className="install-panel__body">
        <h2 className="install-panel__title">{t(title)}</h2>

        {isSignpost && (
          <>
            <p className="install-panel__text">{t('install_signpost_unavailable')}</p>
            <ol className="install-panel__steps">
              <li>{t(manualHintKey())}</li>
            </ol>
            {deepLink && (
              <a className="install-panel__link" href={deepLink} rel="noreferrer noopener">
                {t('install_app_cta')}
              </a>
            )}
          </>
        )}

        {isManual && (
          <>
            <p className="install-panel__text">{t('install_app_body')}</p>
            <p className="install-panel__text install-panel__text--muted">
              {t(manualHintKey())}
            </p>
          </>
        )}

        {canPrompt && (
          <>
            <p className="install-panel__text">{t('install_app_body')}</p>
            <button className="install-panel__cta" type="button" onClick={install}>
              {t('install_app_cta')}
            </button>
          </>
        )}

        <p className="install-panel__note">{t('install_app_note_no_custody')}</p>

        {isSignpost && (
          <p className="install-panel__note install-panel__note--warn">
            <strong>{t('low_security_notice_title')}</strong> — {t('low_security_notice_body')}
          </p>
        )}
      </div>

      <button
        className="install-panel__dismiss"
        type="button"
        onClick={dismiss}
        aria-label={t('install_app_later')}
      >
        {t('install_app_later')}
      </button>
    </aside>
  );
};

export default InstallPanel;
