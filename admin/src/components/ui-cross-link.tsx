/**
 * The board's cross-link to the other admin UI, rendered ONLY from the
 * router's `ui_links` answer (see ../lib/ui-links.ts for why a constant or a
 * host-derived URL is wrong).
 *
 * Three properties, each a decision record:
 *  - the href is the router's url verbatim (never `location.hostname` + a port);
 *  - HTTPS only — an `http://` answer is not advertised (D6);
 *  - empty url => NO anchor at all, just the reason as a plain line. A
 *    disabled-looking dead button is exactly what D5 forbids.
 *
 * Written with `h()` rather than JSX on purpose: the shared (repo-root) vitest
 * config compiles JSX with the React runtime, while this app ships Preact. The
 * explicit `h()` keeps the component renderable under both, so the unit test
 * can mount it in jsdom and assert on real DOM (no anchor vs. an anchor with
 * the router's href) without a React/Preact JSX-runtime mismatch.
 */
import { h } from 'preact';
import { crossLinkFor, type UiLinks } from '../lib/ui-links';

interface Props {
  /** The parsed `tollgate.ui_links` answer; null while it is still loading. */
  payload: UiLinks | null;
  /** Visible label; the UI named in the router's answer is LuCI. */
  label?: string;
  className?: string;
}

export default function UiCrossLink({
  payload,
  label = 'OpenWrt LuCI',
  className,
}: Props) {
  // Still loading: render nothing. Not a disabled button that never enables.
  if (!payload) return null;

  const link = crossLinkFor(payload, 'luci');

  if (!link.available) {
    return h(
      'p',
      {
        className: className ? `${className} ui-crosslink-reason` : 'ui-crosslink-reason',
        'data-ui-crosslink': 'unavailable',
        title: link.reason,
      },
      `${label}: ${link.reason}`,
    );
  }

  return h(
    'a',
    {
      className: className ? `${className} ui-crosslink` : 'ui-crosslink',
      'data-ui-crosslink': 'available',
      // The router's url, verbatim. Host and port both come from its answer.
      href: link.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      referrerpolicy: 'no-referrer',
    },
    `${label} →`,
  );
}
