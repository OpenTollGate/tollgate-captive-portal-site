/**
 * Cross-links between the router's two admin UIs.
 *
 * The board's link to the OTHER UI (LuCI) is a ROUTER ANSWER, never a
 * constant. Whether LuCI answers :8080 (plus :443) or :8090 (plus :8443)
 * depends on the live mapping, and an operator can move it back by setting
 * `entry_ui=luci` (`docs/architecture/default-ui-and-entry-port-decision.md`,
 * D5/D6/D8). A hardcoded `http://<host>:8080/` anchor is therefore wrong in at
 * least one of the two mappings — and a host-derived guess
 * (`https://${location.hostname}:8443/`) is the same bug wearing a scheme.
 *
 * So this module only ever *parses* what the router said:
 *
 *   tollgate ui links --json  ->  {"entry_ui":"board",
 *                                  "links":{"board":{"url":"https://gw.lan/",
 *                                                    "port":"8080","tls_port":"443",
 *                                                    "reason":""},
 *                                           "luci":{"url":"",
 *                                                   "port":"8090","tls_port":"8443",
 *                                                   "reason":"no HTTPS listener on 8443"}}}
 *
 * `url` is empty when that UI has no usable link, and `reason` then says why.
 * We never build a URL from `location` — the router's answer already carries
 * the correct host and port.
 *
 * Pure logic, no DOM and no `location` access, so it is unit-testable without
 * a browser.
 */

/** One UI's link, exactly as the router reported it. */
export interface UiLink {
  /** Empty when this UI has no usable cross-link. Never guessed. */
  url: string;
  /** The pair this UI answers on in the CURRENT mapping (strings, per the CLI). */
  port: string;
  tls_port: string;
  /** Why `url` is empty; empty string when `url` is present. */
  reason: string;
}

export interface UiLinks {
  /** Which UI owns the entry pair in the live mapping: "board" | "luci". */
  entry_ui: string;
  links: {
    board: UiLink;
    luci: UiLink;
  };
}

/** The UI the board links to: the *other* one. */
export type UiLinkKey = 'luci' | 'board';

/** Shown when the router did not answer at all (older package, no plugin). */
export const UI_LINKS_UNANSWERED = 'the router did not report a LuCI address';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function emptyLink(reason: string): UiLink {
  return { url: '', port: '', tls_port: '', reason };
}

/** A payload with no usable link on either side, carrying `reason`. */
export function emptyUiLinks(reason: string = UI_LINKS_UNANSWERED): UiLinks {
  return {
    entry_ui: '',
    links: {
      board: emptyLink(reason),
      luci: emptyLink(reason),
    },
  };
}

function parseLink(raw: any): UiLink {
  return {
    url: asString(raw?.url),
    port: asString(raw?.port),
    tls_port: asString(raw?.tls_port),
    reason: asString(raw?.reason),
  };
}

/**
 * Tolerant parse of the `tollgate ui links --json` / `tollgate.ui_links` ubus
 * reply. An unreadable payload yields two empty links, never a fabricated URL.
 */
export function parseUiLinks(data: any): UiLinks {
  if (!data || typeof data !== 'object' || !data.links) {
    return emptyUiLinks();
  }
  return {
    entry_ui: asString(data.entry_ui),
    links: {
      board: parseLink(data.links.board),
      luci: parseLink(data.links.luci),
    },
  };
}

/** The single decision the UI is allowed to make: is there a link, and to what? */
export interface CrossLink {
  /** True only for an HTTPS url the router answered with. */
  available: boolean;
  /** The router's url verbatim, or '' when unavailable. Never constructed. */
  url: string;
  /** Why there is no link (always set when `available` is false). */
  reason: string;
}

/**
 * Pick the cross-link for `which` (default: the other UI, LuCI).
 *
 * HTTPS-only: a `http://` url is refused here as well as in the component, so a
 * plain-HTTP admin pair can never be *advertised* (D6). Refusing it also means
 * an http anchor can never become a mixed-content block or a 307 to a dead
 * listener. An unavailable link always carries a reason to surface.
 */
export function crossLinkFor(
  payload: UiLinks | null | undefined,
  which: UiLinkKey = 'luci',
): CrossLink {
  const link = payload?.links?.[which];
  const url = (link?.url ?? '').trim();
  const reason = (link?.reason ?? '').trim();

  if (!url) {
    return {
      available: false,
      url: '',
      reason: reason || UI_LINKS_UNANSWERED,
    };
  }
  if (!/^https:\/\//i.test(url)) {
    return {
      available: false,
      url: '',
      reason: 'admin cross-links are HTTPS-only',
    };
  }
  return { available: true, url, reason: '' };
}
