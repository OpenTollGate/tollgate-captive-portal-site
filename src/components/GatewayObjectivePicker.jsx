// Gateway-objective picker.
//
// A buyer chooses HOW their traffic leaves the internet (cheapest / fastest /
// balanced). The choice is PINNED to the session on the router side
// (`allow_change: next_session`), so this component may say exactly one thing
// about timing: it applies to the NEXT session. There is no "switch now" — the
// session already sold keeps the mix it was sold.
//
// Rendering rules, in order:
//   * no capability (404 / timeout / enabled:false / malformed) -> render null;
//     no placeholder, no disabled shell, nothing a buyer could click.
//   * capability present -> title, subtitle and one radio row per objective.
//   * allow_change === "never" -> the rows are shown DISABLED with the
//     next-session sentence explaining why; the control is never hidden, so a
//     buyer who expects to change something is told, not silently ignored.
//   * a different objective selected while a session is active -> the button
//     reads "Use for next session".

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// helpers
import {
  fetchGatewayObjectives,
  submitGatewayObjective,
  objectiveLabelKey,
} from '../helpers/objectives.js';

// styles
import './GatewayObjectivePicker.scss';

// The CTA label is a pure function of state so it can be asserted directly.
//   allow_change never -> the router refuses the change; explain, do not offer.
//   nothing staged     -> nothing to apply: render no CTA rather than a dead one.
//   change staged      -> "Use for next session". The objective is applied when a
//                         session starts, so this label is correct both for a
//                         buyer who has not paid yet (the session they are about
//                         to start) and for one mid-session (the next one). It is
//                         never "Switch now": that would promise the router
//                         re-derives a mix for a session already sold.
export const ctaState = ({ selected, current, allowChange, t }) => {
  if (allowChange === 'never') {
    // The reason goes in the note above (gateway.applies_next_session), not in
    // the button: a disabled CTA must stay a short label, not a paragraph.
    return { label: t('gateway.choice_locked'), disabled: true, hidden: false };
  }
  if (!selected || selected === current) {
    // The current objective is already in force — there is nothing to apply, so
    // no button is rendered. A disabled button here would read as a broken
    // action next to an option already marked as current.
    return { label: t('gateway.current'), disabled: true, hidden: true };
  }
  return { label: t('gateway.use_for_next_session'), disabled: false, hidden: false };
};

export const GatewayObjectivePicker = ({
  // Timing copy is unconditional: a reopened portal may already have a session.
  fetchImpl,
  submitImpl,
}) => {
  const { t } = useTranslation();
  const [capability, setCapability] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;

    fetchGatewayObjectives(fetchImpl).then((result) => {
      // the probe can resolve after unmount (it has a 4s timeout); never set
      // state on a dead component or the portal logs a React warning per visit
      if (!active || !result) return;
      setCapability(result);
      setSelected(result.current);
    });

    return () => {
      active = false;
      mounted.current = false;
    };
    // the probe runs once per mount; `fetchImpl` is a test seam, not a trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cta = useMemo(
    () =>
      capability
        ? ctaState({
            selected,
            current: capability.current,
            allowChange: capability.allowChange,
            t,
          })
        : null,
    [capability, selected, t],
  );

  // nothing to render: the router never claimed the capability
  if (!capability) return null;

  const locked = capability.allowChange === 'never';

  const handleSubmit = async () => {
    if (!selected || locked || submitting || cta.disabled || outcome === 'unsupported') return;
    setSubmitting(true);
    setOutcome(null);
    const result = await submitGatewayObjective(selected, submitImpl);
    if (!mounted.current) return;
    setSubmitting(false);
    // 'unsupported' means the read route exists but the write route does not —
    // report the truth instead of pretending the choice was stored
    setOutcome(result);
  };

  return (
    <section
      className="tollgate-captive-portal-objectives"
      data-testid="gateway-objectives"
      data-locked={locked}
    >
      <h3 className="tollgate-captive-portal-objectives-title">
        {t('gateway.choose.title')}
      </h3>
      <p className="tollgate-captive-portal-objectives-subtitle">
        {t('gateway.choose.subtitle')}
      </p>

      <fieldset
        className="tollgate-captive-portal-objectives-options"
        disabled={locked || submitting || outcome === 'unsupported'}
      >
        {capability.objectives.map((objective) => {
          const labelKey = objectiveLabelKey(objective.id);
          const label = labelKey ? t(labelKey) : objective.label;
          const isCurrent = objective.id === capability.current;

          return (
            <label
              key={objective.id}
              className="tollgate-captive-portal-objectives-option"
              data-testid={`gateway-objective-${objective.id}`}
              data-selected={selected === objective.id}
              data-current={isCurrent}
            >
              <input
                type="radio"
                name="gateway-objective"
                value={objective.id}
                checked={selected === objective.id}
                disabled={locked || submitting || outcome === 'unsupported'}
                onChange={() => {
                  setSelected(objective.id);
                  setOutcome(null);
                }}
              />
              <span className="tollgate-captive-portal-objectives-option-label">
                {label}
                {isCurrent && (
                  <span className="tollgate-captive-portal-objectives-option-current">
                    {' '}
                    · {t('gateway.current')}
                  </span>
                )}
              </span>
              {objective.summary && (
                <span className="tollgate-captive-portal-objectives-option-summary">
                  {objective.summary}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      {/* Always state the timing, including sessions already active on page load. */}
      <p
          className="tollgate-captive-portal-objectives-note"
          data-testid="gateway-applies-next-session"
        >
          {t('gateway.applies_next_session')}
      </p>

      {!cta.hidden && (
        <button
          type="button"
          className="cta tollgate-captive-portal-objectives-submit"
          data-testid="gateway-objectives-submit"
          disabled={cta.disabled || submitting || outcome === 'unsupported'}
          onClick={handleSubmit}
        >
          {submitting ? t('processing') : cta.label}
        </button>
      )}

      {outcome === 'ok' && (
        <p
          className="small tollgate-captive-portal-objectives-outcome"
          data-testid="gateway-objectives-stored"
          role="status"
        >
          {t('gateway.applies_next_session')}
        </p>
      )}
      {outcome === 'unsupported' && (
        <p
          className="small tollgate-captive-portal-objectives-outcome"
          data-testid="gateway-objectives-unsupported"
          role="status"
        >
          {t('gateway.unavailable')}
        </p>
      )}
      {outcome === 'error' && (
        <p
          className="small tollgate-captive-portal-objectives-outcome"
          data-testid="gateway-objectives-error"
          role="status"
        >
          {t('gateway.unavailable')}
        </p>
      )}
    </section>
  );
};

export default GatewayObjectivePicker;
