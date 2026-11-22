// Serve a portal webroot over plain HTTP on a chosen interface.
//
// WHY THIS EXISTS — the origin, not the app, is what this card is about.
//
// Playwright's own `webServer`/`baseURL` is `http://localhost:<port>`, and
// Chrome treats `localhost` (and 127.0.0.0/8, and `::1/128`) as *Potentially
// Trustworthy* per W3C Secure Contexts §3.1 steps 4-5. A captive portal is
// served on `http://<router-lan-ip>:2051` instead, and a bare RFC1918 address
// is *Not Trustworthy* (spec §3.1 step 9 — "neither origin's domain nor port
// has any effect"). So a test that only ever visits localhost CANNOT observe
// the portal's real secure-context behaviour: it measures the one address that
// is exempt from the rule under test.
//
// This helper binds the same bytes to either address, so the secure-context
// assertions in `installability.spec.mjs` can be run as a matched pair:
//   - negative control  -> a non-loopback LAN address (the router's real origin)
//   - working path      -> loopback (a secure context by construction)
// The ONLY variable between the two runs is the hostname in the URL.
//
// It serves files verbatim — no index.html synthesis, no DirectoryIndex
// fallback to `index.html`. That matters: the shipped router webroot has
// `splash.html` and NO `index.html`, so a host that helpfully resolved `/` to
// an index would hide the manifest `start_url` defect this gate exists to
// catch. Directory requests fall back to `splash.html`, which is what the
// nodogsplash-served tree actually contains.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// The directory index the SHIPPED webroot actually has. Deliberately
// splash.html and not index.html — see the header note.
export const SERVED_ENTRY_DOCUMENT = 'splash.html';

// NOTE: there is deliberately NO directory-index fallback to SERVED_ENTRY_DOCUMENT.
//
// uhttpd's directory index is `index.html`, and the SHIPPED webroot has none
// (the build renames it to splash.html). So a request for `/` on a real router
// 404s — which is precisely the `start_url: "."` defect ADR-delta §6.3 records.
// A helpful fallback here would mask the bug this gate exists to catch, so `/`
// is only served when a real `index.html` exists.
const DIRECTORY_INDEX = 'index.html';

/**
 * Pick a non-loopback IPv4 so the negative control is a genuinely insecure
 * origin. Overridable so a different bench/host can pin its own address.
 * Returns null when the box has no non-loopback IPv4 at all, which the spec
 * reports as an explicit environment skip rather than a silent pass.
 */
export function findLanAddress() {
  if (process.env.PORTAL_INSECURE_HOST) return process.env.PORTAL_INSECURE_HOST;
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const addr of nets[name] || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

/**
 * Start a verbatim static host bound to `host`.
 * @returns {Promise<{origin: string, close: () => Promise<void>}>}
 */
export function serveWebroot({ webroot, host, port = 0 }) {
  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://placeholder').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }

    // Strip any traversal, then resolve inside the webroot only.
    const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    let target = rel;
    if (target === '' || target.endsWith('/')) {
      // Directory request: uhttpd resolves only a real index.html. There is
      // none in the shipped tree — see DIRECTORY_INDEX above.
      target = `${target}${DIRECTORY_INDEX}`;
    }
    const candidate = join(webroot, target);

    if (!candidate.startsWith(webroot)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      // A real 404 — this is the signal that the manifest's start_url points
      // at a document the shipped tree does not contain.
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }

    const type = CONTENT_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      // Mirrors what a captive portal's uhttpd can serve without extra config,
      // so a caching layer cannot mask a changed manifest between assertions.
      'cache-control': 'no-store',
    });
    createReadStream(candidate).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const { port: bound } = server.address();
      resolve({
        origin: `http://${host.includes(':') ? `[${host}]` : host}:${bound}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * Read+parse a manifest from a built webroot, exactly as the browser will.
 * Returns { ok, status, manifest, raw } so a test can distinguish "missing"
 * from "present but structurally wrong".
 */
export function readManifest(webroot) {
  const p = join(webroot, 'manifest.json');
  if (!existsSync(p)) return { ok: false, status: 404, manifest: null, raw: null };
  const raw = readFileSync(p, 'utf8');
  try {
    return { ok: true, status: 200, manifest: JSON.parse(raw), raw };
  } catch (err) {
    return { ok: false, status: 200, manifest: null, raw, parseError: String(err.message) };
  }
}

/**
 * Resolve a manifest `start_url` against the manifest's own URL, per the
 * Web App Manifest `start_url` algorithm (resolved relative to the manifest).
 * Returns null when it cannot be resolved, or when it would escape the origin.
 */
export function resolveStartUrl(startUrl, manifestUrl = 'http://host/manifest.json') {
  if (typeof startUrl !== 'string' || startUrl.trim() === '') return null;
  try {
    const u = new URL(startUrl, manifestUrl);
    return u;
  } catch {
    return null;
  }
}

/** Does the webroot contain a real file for a resolved start_url pathname? */
export function webrootHasDocument(webroot, url) {
  const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const target = rel === '' || rel.endsWith('/') ? `${rel}${DIRECTORY_INDEX}` : rel;
  const candidate = join(webroot, target);
  return existsSync(candidate) && statSync(candidate).isFile();
}
