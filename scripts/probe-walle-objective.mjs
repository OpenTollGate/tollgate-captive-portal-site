#!/usr/bin/env node
// probe-walle-objective.mjs — the standing ralph objective for `walle.cashu.me`.
//
// WHY THIS EXISTS
// The operator brief for the client-side Cashu wallet said the PWA would carry
// "something like walle.cashu.me internally". That host is not a design input:
// measured 2026-10-14 it served Traefik's default self-signed certificate and
// answered `404 page not found` on every path. The requirement was therefore
// never validated, and it may become true (or be replaced) at any time. So it
// is a *standing* objective, not a one-shot check: run this and the current
// answer is measured again, then recorded where the design reads it.
//
// CONTRACT
// - Exit code is 0 for every *measured* verdict, including NOT_VALIDATABLE.
//   A refused connection, a self-signed certificate, a 404 and a redirect are
//   all findings. Only a usage error exits 2, so a ralph turn can tell "the
//   answer is still no" apart from "the probe itself is broken".
// - `--json` prints one JSON object; `--write <path>` appends that same object
//   as one line to a verdict log, so the answer is recorded, not just printed.
//
// TWO PASSES, AND WHY
//   pass 1 (STRICT)     a normal verified TLS connection. Only this pass can
//                       produce `VALIDATED`, because only this pass establishes
//                       the origin's identity.
//   pass 2 (UNVERIFIED) runs only when pass 1 could not establish identity. It
//                       answers "what does this host actually present and
//                       serve?" — the certificate it offers and the body it
//                       returns — over a handshake that established nothing.
//                       Nothing in it is trusted, nothing secret is ever sent on
//                       it, and the record labels it
//                       `evidence_source: "unverified-handshake"`. Without it
//                       the honest answer to "what does walle.cashu.me serve?"
//                       would be "unmeasurable", which is exactly the false
//                       premise this objective exists to kill off.
//
// VERDICTS
//   VALIDATED        strict TLS trusted + 2xx + a wallet-shaped body on `/`.
//                    Architecture is then extracted from that body.
//   NOT_VALIDATABLE  anything else. The design must not depend on this host.
//
// The probe deliberately does NOT follow redirects: a redirect is a fact about
// the origin that the record must keep, and following it would let a different
// origin's content be attributed to this one.
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:tls';
import { appendFileSync, readFileSync } from 'node:fs';

const DEFAULT_URL = 'https://walle.cashu.me/';
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 512 * 1024;
const PROBE_VERSION = 2;

// `/` is the origin's identity; `/manifest.json` is what an installable wallet
// must expose and is cheap to describe.
const PATHS = ['/', '/manifest.json'];

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function usage() {
  return [
    'usage: probe-walle-objective.mjs [--url <https url>] [--timeout <ms>]',
    '                                 [--ca <pem path>] [--json] [--write <path>]',
    '                                 [--label <text>] [--path <p>]...',
    '',
    'Exit 0 for any measured verdict (VALIDATED or NOT_VALIDATABLE).',
    'Exit 2 for a usage error.',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    ca: null,
    json: false,
    write: null,
    label: null,
    paths: [...PATHS],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      i += 1;
      return v;
    };
    if (a === '--url') opts.url = next();
    else if (a === '--timeout') opts.timeout = Number(next());
    else if (a === '--ca') opts.ca = next();
    else if (a === '--json') opts.json = true;
    else if (a === '--write') opts.write = next();
    else if (a === '--label') opts.label = next();
    else if (a === '--path') opts.paths.push(next());
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function classify(err, stage) {
  // A TLS failure surfaces as a connect-stage error; name it so the record says
  // "the certificate did not chain" rather than "unreachable".
  const code = err?.code ?? null;
  return {
    stage: TLS_CODES.has(code) ? 'tls' : stage,
    code: code ?? (err?.name || 'Error'),
    message: String(err?.message ?? err),
  };
}

function certFields(socket) {
  const cert = socket.getPeerCertificate(false);
  if (!cert || Object.keys(cert).length === 0) return null;
  return {
    subject: cert.subject?.CN ?? null,
    issuer: cert.issuer?.CN ?? null,
    valid_from: cert.valid_from ?? null,
    valid_to: cert.valid_to ?? null,
    serial: cert.serialNumber ?? null,
    alt_names: cert.subjectaltname ?? null,
  };
}

/**
 * One HTTPS request. Resolves (never rejects) with either an observation or an
 * error record — the caller turns the pair into a verdict.
 */
function requestOnce({ url, timeout, ca, verify }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = httpsRequest(
        url,
        {
          method: 'GET',
          headers: {
            'user-agent': `walle-objective-probe/${PROBE_VERSION}`,
            accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          },
          ...(ca ? { ca } : {}),
          // Only `describeUnverified()` passes verify:false, and nothing it
          // observes can produce a VALIDATED verdict.
          ...(verify ? {} : { rejectUnauthorized: false }),
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size <= MAX_BODY_BYTES) chunks.push(c);
          });
          res.on('end', () => {
            done({
              error: null,
              response: {
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
                truncated: size > MAX_BODY_BYTES,
              },
            });
          });
          res.on('error', (err) => done({ error: classify(err, 'body'), response: null }));
        },
      );
    } catch (err) {
      done({ error: classify(err, 'request'), response: null });
      return;
    }

    req.setTimeout(timeout, () => {
      req.destroy(Object.assign(new Error('probe timeout'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', (err) => done({ error: classify(err, 'connect'), response: null }));
    req.end();
  });
}

/** STRICT pass: does the origin's identity hold up? */
function strictTls(opts, ca) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let target;
    try {
      target = new URL(opts.url);
    } catch {
      done(null);
      return;
    }

    let socket;
    try {
      socket = connect(
        {
          host: target.hostname,
          port: Number(target.port || 443),
          servername: target.hostname,
          ...(ca ? { ca } : {}),
        },
        () => {
          done({
            trusted: socket.authorized === true,
            authorized_error: socket.authorizationError
              ? String(socket.authorizationError)
              : null,
            protocol: socket.getProtocol?.() ?? null,
            ...(certFields(socket) ?? {}),
          });
          socket.end();
        },
      );
    } catch (err) {
      done({ trusted: false, authorized_error: String(err?.code ?? 'ERR') });
      return;
    }

    socket.setTimeout(opts.timeout, () =>
      socket.destroy(Object.assign(new Error('tls timeout'), { code: 'ETIMEDOUT' })),
    );
    socket.on('error', (err) => {
      done({ trusted: false, authorized_error: String(err?.code ?? 'ERR') });
      socket.destroy();
    });
  });
}

/**
 * UNVERIFIED pass — evidence collection only. Identity is NOT established here,
 * so nothing it returns can validate the origin; it exists so the record can
 * say what the host actually presents and serves.
 */
async function describeUnverified(opts, ca) {
  const described = {
    evidence_source: 'unverified-handshake',
    note: 'identity NOT established: the strict pass could not verify this origin',
    tls: null,
    paths: {},
  };

  described.tls = await new Promise((resolve) => {
    let target;
    try {
      target = new URL(opts.url);
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let socket;
    try {
      socket = connect(
        {
          host: target.hostname,
          port: Number(target.port || 443),
          servername: target.hostname,
          rejectUnauthorized: false,
          ...(ca ? { ca } : {}),
        },
        () => {
          done({
            ...(certFields(socket) ?? {}),
            protocol: socket.getProtocol?.() ?? null,
            trusted: false,
          });
          socket.end();
        },
      );
    } catch {
      done(null);
      return;
    }
    socket.setTimeout(opts.timeout, () => socket.destroy());
    socket.on('error', () => {
      done(null);
      socket.destroy();
    });
  });

  for (const path of opts.paths) {
    const target = new URL(path, opts.url).toString();
    const { error, response } = await requestOnce({
      url: target,
      timeout: opts.timeout,
      ca,
      verify: false,
    });
    described.paths[path] = {
      path,
      error,
      status: response?.status ?? null,
      location: response?.headers?.location ?? null,
      body: response
        ? describeBody(response.body, response.headers?.['content-type'] ?? null)
        : null,
    };
  }

  return described;
}

/**
 * Describe what a body is, without pretending to be a browser. Anything that
 * cannot be established is left out rather than guessed.
 */
function describeBody(body, contentType) {
  const text = body ?? '';
  // Quasar's shell puts its asset tags after a multi-KB inline style block, so
  // a smaller window would miss exactly what this probe is looking for.
  const head = text.slice(0, 8000);

  const titleMatch = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(head);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const assets = [
    ...head.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs|css))["']/gi),
  ].map((m) => m[1]);
  const manifestMatch =
    /<link[^>]+rel=["']?manifest["']?[^>]*href=["']([^"']+)["']/i.exec(head);

  // Stack hints: only well-known markers, and only as hints.
  const stack = [];
  if (/id=["']q-app["']/.test(head)) stack.push('quasar'); // Vue/Quasar mount div
  if (/__VUE__|data-v-[0-9a-f]{6,}/.test(text)) stack.push('vue');
  if (/_next\/static|__NEXT_DATA__/.test(head)) stack.push('nextjs');
  if (/serviceWorker/.test(text)) stack.push('service-worker-ref');
  if (/\bdexie\b|indexeddb/i.test(text)) stack.push('indexeddb');
  if (/\blocalStorage\b/.test(text)) stack.push('localstorage');

  const looksHtml = /<html|<body|<!doctype html/i.test(head);
  const isNotFound =
    /^404 page not found\b/i.test(text.trim()) ||
    (looksHtml && /^404\b|not found/i.test(title ?? ''));
  const isJson = (contentType ?? '').includes('json') || /^[[{]/.test(text.trim());

  // Independent shell signals. Kept separate from `shape` because they are what
  // `buildArch` reasons over, and a reader must be able to see which of them
  // actually fired rather than infer it from a verdict.
  const hasSpaMount =
    /<script[^>]+type=["']module["']/i.test(head) ||
    /id=["'](q-app|app|root)["']/.test(head);
  const hasManifest = Boolean(manifestMatch);
  const titleMentionsWallet = /cashu|wallet|ecash/i.test(title ?? '');

  let shape;
  if (isNotFound) shape = 'not_found';
  else if (!text.trim()) shape = 'empty';
  else if (looksHtml && title) shape = 'html';
  else if (looksHtml) shape = 'html_untitled';
  else if (isJson) shape = 'json';
  else shape = 'text';

  return {
    shape,
    title,
    bytes: Buffer.byteLength(text, 'utf8'),
    content_type: contentType ?? null,
    assets: assets.slice(0, 20),
    manifest: manifestMatch ? manifestMatch[1] : null,
    stack,
    signals: { has_spa_mount: hasSpaMount, has_manifest: hasManifest, title_mentions_wallet: titleMentionsWallet },
  };
}

function buildArch(bodyInfo) {
  // Architecture is only claimed from a body that actually rendered a shell.
  if (!bodyInfo) return null;
  if (bodyInfo.shape !== 'html' && bodyInfo.shape !== 'html_untitled') return null;

  const s = bodyInfo.signals ?? {};
  const knownStack = bodyInfo.stack.some((x) => ['quasar', 'vue', 'nextjs'].includes(x));
  // A wallet UI is either a recognised framework shell, or a shell that names
  // itself as a wallet AND carries the install/runtime markers such an app has.
  // One signal alone is not enough: a generic "app" page is not a wallet.
  const isWalletUi =
    knownStack || (Boolean(s.title_mentions_wallet) && Boolean(s.has_manifest || s.has_spa_mount));

  return {
    is_wallet_ui: isWalletUi,
    title: bodyInfo.title,
    assets: bodyInfo.assets,
    manifest: bodyInfo.manifest,
    stack: bodyInfo.stack,
    signals: s,
    // A shell page cannot be introspected for its storage layout; report only
    // what the page itself names rather than guessing.
    storage: bodyInfo.stack.filter((x) => x === 'indexeddb' || x === 'localstorage'),
  };
}

async function probe(opts) {
  const record = {
    probe_version: PROBE_VERSION,
    probed_at: new Date().toISOString(),
    url: opts.url,
    label: opts.label,
    verdict: 'NOT_VALIDATABLE',
    reachable: false,
    reason: null,
    tls: null,
    http: null,
    body_shape: null,
    arch: null,
    unverified: null,
    paths: {},
    error: null,
  };

  let ca = null;
  try {
    if (opts.ca) ca = readFileSync(opts.ca, 'utf8');
  } catch (err) {
    record.error = {
      stage: 'args',
      code: err.code ?? 'CA_READ_FAILED',
      message: String(err.message),
    };
    record.reason = 'could not read the CA file';
    return record;
  }

  // ---- pass 1: STRICT -----------------------------------------------------
  record.tls = await strictTls(opts, ca);

  for (const path of opts.paths) {
    const target = new URL(path, opts.url).toString();
    const { error, response } = await requestOnce({
      url: target,
      timeout: opts.timeout,
      ca,
      verify: true,
    });
    record.paths[path] = {
      path,
      error,
      status: response?.status ?? null,
      location: response?.headers?.location ?? null,
      body: response
        ? describeBody(response.body, response.headers?.['content-type'] ?? null)
        : null,
    };
  }

  const root = record.paths[opts.paths[0]];

  // ---- pass 2: unverified description -------------------------------------
  // Runs whenever the strict pass established no identity, so the record always
  // says what the host presents — including when the connection was refused,
  // where the pass simply finds nothing.
  if (record.tls?.trusted !== true) {
    record.error = root.error ?? record.error;
    record.reason =
      root.error?.stage === 'tls'
        ? 'the certificate does not chain to a trust anchor'
        : root.error?.stage === 'connect' || root.error?.stage === 'request'
          ? 'nothing answered at the address'
          : 'the certificate does not chain to a trust anchor';
    record.unverified = await describeUnverified(opts, ca);
    // The verdict stays NOT_VALIDATABLE: evidence about an unauthenticated
    // origin is not a validation of it.
    return record;
  }

  record.http = {
    status: root.status,
    location: root.location,
    content_type: root.body?.content_type ?? null,
  };
  record.body_shape = root.body?.shape ?? null;
  record.arch = buildArch(root.body);
  // A redirect has no meaningful body shape; name the fact itself.
  if (root.status >= 300 && root.status < 400) record.body_shape = 'redirect';
  // ...and a body that IS a wallet shell is named as such, so a reader of the
  // record does not have to re-derive it from `arch`.
  else if (record.arch?.is_wallet_ui) record.body_shape = 'wallet_ui';
  // `reachable` means exactly one thing: the origin's identity held up AND it
  // answered. Whether what it answered is a wallet is the verdict's business.
  record.reachable = true;

  if (record.http.status >= 300 && record.http.status < 400) {
    record.reason = 'the origin redirects; the target is not this host';
    return record;
  }
  if (record.http.status < 200 || record.http.status >= 300) {
    record.reason = `the origin answered ${record.http.status} at ${opts.paths[0]}`;
    return record;
  }
  if (!record.arch || !record.arch.is_wallet_ui) {
    record.reason = 'the origin answered 2xx but serves no wallet UI';
    return record;
  }

  record.verdict = 'VALIDATED';
  record.reason = 'strict TLS trusted, 2xx, wallet-shaped body';
  return record;
}

function renderHuman(record) {
  const lines = [];
  lines.push(`walle objective — ${record.url}`);
  lines.push(`  probed_at   ${record.probed_at}`);
  lines.push(`  verdict     ${record.verdict}`);
  if (record.reason) lines.push(`  reason      ${record.reason}`);

  // The strict record only carries trust + error; the certificate that was
  // actually *presented* is described on the unverified pass. Merge so the
  // human line never prints "-" for a cert the probe did see.
  const tls = record.tls ? { ...record.unverified?.tls, ...record.tls } : record.unverified?.tls ?? null;
  if (tls) {
    lines.push(
      `  tls         trusted=${record.tls?.trusted === true} ` +
        `subject="${tls.subject ?? '-'}" issuer="${tls.issuer ?? '-'}" ${tls.protocol ?? ''}`,
    );
    if (tls.valid_to) lines.push(`              valid_to=${tls.valid_to}`);
  }
  if (record.tls?.authorized_error) lines.push(`  tls_error   ${record.tls.authorized_error}`);

  if (record.http)
    lines.push(
      `  http        ${record.http.status}` +
        `${record.http.location ? ` -> ${record.http.location}` : ''}` +
        ` content-type=${record.http.content_type ?? '-'}`,
    );
  if (record.body_shape) lines.push(`  body        ${record.body_shape}`);
  if (record.error)
    lines.push(`  error       ${record.error.stage}/${record.error.code}: ${record.error.message}`);

  if (record.unverified) {
    const uRoot = record.unverified.paths?.['/'] ?? {};
    lines.push(
      `  unverified  ${uRoot.status ?? uRoot.error?.code ?? '-'} ` +
        `body=${uRoot.body?.shape ?? '-'} (identity NOT established — evidence only)`,
    );
    for (const [path, entry] of Object.entries(record.unverified.paths ?? {})) {
      if (path === '/') continue;
      lines.push(`              ${path} -> ${entry.status ?? entry.error?.code ?? '-'}`);
    }
  }

  if (record.arch) {
    lines.push(
      `  arch        title="${record.arch.title ?? '-'}" stack=[${record.arch.stack.join(',')}]`,
    );
    if (record.arch.assets.length)
      lines.push(`              assets=${record.arch.assets.join(' ')}`);
    if (record.arch.manifest) lines.push(`              manifest=${record.arch.manifest}`);
  }
  return lines.join('\n');
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    const bad = {
      probe_version: PROBE_VERSION,
      probed_at: new Date().toISOString(),
      url: null,
      verdict: 'NOT_VALIDATABLE',
      reachable: false,
      reason: 'usage error',
      error: { stage: 'args', code: 'USAGE', message: String(err.message) },
    };
    process.stdout.write(`${JSON.stringify(bad)}\n`);
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    process.exit(2);
  }

  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (!/^https:\/\//i.test(opts.url)) {
    const bad = {
      probe_version: PROBE_VERSION,
      probed_at: new Date().toISOString(),
      url: opts.url,
      verdict: 'NOT_VALIDATABLE',
      reachable: false,
      reason: 'usage error: --url must be an https URL',
      error: { stage: 'args', code: 'URL_NOT_HTTPS', message: opts.url },
    };
    process.stdout.write(`${JSON.stringify(bad)}\n`);
    process.stderr.write(`--url must be an https URL, got: ${opts.url}\n`);
    process.exit(2);
  }

  const record = await probe(opts);

  if (opts.write) {
    try {
      appendFileSync(opts.write, `${JSON.stringify(record)}\n`);
    } catch (err) {
      process.stderr.write(
        `warning: could not append to ${opts.write}: ${err.code ?? err.message}\n`,
      );
    }
  }

  if (opts.json) process.stdout.write(`${JSON.stringify(record)}\n`);
  else process.stdout.write(`${renderHuman(record)}\n`);
}

main();
