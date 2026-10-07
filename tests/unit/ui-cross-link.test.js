// The board's cross-link to the OTHER admin UI (LuCI) is a ROUTER ANSWER.
//
// Whether LuCI answers :8080/:443 or :8090/:8443 depends on the live mapping
// (docs/architecture/default-ui-and-entry-port-decision.md, D5/D6); the
// mapping flips with `entry_ui`. So:
//
//   * the anchor's href must be the url the router reported, verbatim;
//   * an empty url means NO anchor at all — just the reason, never a
//     disabled-looking dead button and never a URL rebuilt from
//     location.hostname + a guessed port;
//   * a plain-HTTP answer is not advertised (D6).
//
// The component is written with `h()` (no JSX) so it renders under this repo's
// React-configured vitest without a Preact/React JSX-runtime mismatch. The
// tests mount it in jsdom and assert on real DOM.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import UiCrossLink from '../../admin/src/components/ui-cross-link';
import { crossLinkFor, parseUiLinks, emptyUiLinks } from '../../admin/src/lib/ui-links';

// jsdom gives `import.meta.url` an http scheme, so resolve from the vitest cwd
// (the repo root) instead of fileURLToPath.
const ADMIN_SRC = resolve(process.cwd(), 'admin/src');

// The exact shape `tollgate ui links --json` prints (D5), board as entry_ui.
function routerAnswer(overrides = {}) {
  return parseUiLinks({
    entry_ui: 'board',
    links: {
      board: { url: 'https://gw1.lan/', port: '8080', tls_port: '443', reason: '' },
      luci: {
        url: 'https://gw1.lan:8443/',
        port: '8090',
        tls_port: '8443',
        reason: '',
        ...overrides,
      },
    },
  });
}

function mount(vnode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(vnode, container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a cross-link is rendered from the router answer', () => {
  it('links to the url the router reported, in a new tab, HTTPS', () => {
    const el = mount(h(UiCrossLink, { payload: routerAnswer() }));

    const anchor = el.querySelector('a');
    expect(anchor).not.toBeNull();
    // The router's url, verbatim — host AND port both come from its answer.
    expect(anchor.getAttribute('href')).toBe('https://gw1.lan:8443/');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toContain('noopener');
  });

  it('follows the live mapping: the same component links to whichever port the router names', () => {
    // entry_ui=luci mapping: LuCI owns the entry pair (:8080/:443).
    const el = mount(
      h(UiCrossLink, {
        payload: routerAnswer({ url: 'https://gw1.lan/', port: '8080', tls_port: '443' }),
      })
    );

    expect(el.querySelector('a').getAttribute('href')).toBe('https://gw1.lan/');
  });

  it('renders nothing at all while the answer is still in flight', () => {
    const el = mount(h(UiCrossLink, { payload: null }));

    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent.trim()).toBe('');
  });
});

describe('no url means no anchor — only the reason', () => {
  it('renders the reason and NO anchor when the router answers an empty url', () => {
    const el = mount(
      h(UiCrossLink, {
        payload: routerAnswer({ url: '', reason: 'no HTTPS listener on 8443' }),
      })
    );

    // No dead button: not an anchor, not a disabled-looking element.
    expect(el.querySelector('a')).toBeNull();
    expect(el.innerHTML).not.toContain('href');
    // The reason is surfaced as a plain line.
    expect(el.textContent).toContain('no HTTPS listener on 8443');
    expect(el.querySelector('[data-ui-crosslink="unavailable"]')).not.toBeNull();
  });

  it('does not advertise a plain-HTTP admin pair (HTTPS-only)', () => {
    const el = mount(
      h(UiCrossLink, {
        payload: routerAnswer({ url: 'http://gw1.lan:8080/', reason: '' }),
      })
    );

    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent.toLowerCase()).toContain('https-only');
  });

  it('surfaces a reason when the router did not answer at all', () => {
    const el = mount(h(UiCrossLink, { payload: emptyUiLinks() }));

    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('did not report');
  });
});

describe('nothing is derived from location', () => {
  it('never builds the href from location.hostname/port', () => {
    // jsdom's location.hostname is "localhost"; the href must not mention it.
    const el = mount(h(UiCrossLink, { payload: routerAnswer() }));
    const href = el.querySelector('a').getAttribute('href');

    expect(href).toBe('https://gw1.lan:8443/');
    expect(href).not.toContain(window.location.hostname);
    expect(href).not.toContain(':8080');
  });

  it('crossLinkFor returns the router url or an empty url + reason, never a guess', () => {
    const present = crossLinkFor(routerAnswer());
    expect(present).toEqual({ available: true, url: 'https://gw1.lan:8443/', reason: '' });

    const absent = crossLinkFor(routerAnswer({ url: '', reason: 'certificate does not cover this router' }));
    expect(absent.available).toBe(false);
    expect(absent.url).toBe('');
    expect(absent.reason).toBe('certificate does not cover this router');
  });
});

describe('the hardcoded admin cross-link cannot come back', () => {
  function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }

  // Drop comment-only lines so the explanatory comments that name the very
  // patterns we ban (`location.hostname`, the old `:8080` url) are not
  // reported as offenders. Real code lines are scanned intact.
  function codeOnly(src) {
    return src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !(
          t.startsWith('//') ||
          t.startsWith('/*') ||
          t.startsWith('*') ||
          t.startsWith('*/')
        );
      })
      .join('\n');
  }

  // The two shapes the previous hardcoded anchor used, and the two shapes any
  // regression will use: a url literal pinning the LuCI port, or an address
  // assembled from the browser's own location.
  const BANNED = [
    { why: 'hardcoded :8080 url', re: /:\/\/[^\s"'`]*:8080/ },
    { why: 'builds an address from location.hostname/port', re: /location\.(hostname|port)/ },
  ];

  function scanSource(src) {
    const code = codeOnly(src);
    return BANNED.filter(({ re }) => re.test(code)).map(({ why }) => why);
  }

  it('admin/src contains no host/port guess and no :8080 url literal', () => {
    const files = walk(ADMIN_SRC).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(0);

    const offenders = [];
    for (const file of files) {
      for (const why of scanSource(readFileSync(file, 'utf8'))) {
        offenders.push(`${file}: ${why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan actually catches the url it bans (self-check)', () => {
    // Single quotes mean no interpolation: this is the literal banned line.
    const reintroduced = 'href={`http://${window.location.hostname}:8080/`}';
    expect(scanSource(reintroduced)).toEqual([
      'hardcoded :8080 url',
      'builds an address from location.hostname/port',
    ]);
    // And a comment naming it is NOT a false positive.
    expect(scanSource('// was: href={`http://${window.location.hostname}:8080/`}')).toEqual([]);
  });
});
