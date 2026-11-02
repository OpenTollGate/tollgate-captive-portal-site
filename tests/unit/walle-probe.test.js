import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:https';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { makeFixturePki, portOf } from './helpers/tls-fixtures.js';

// The SUT is written to be invoked by path, exactly as the ralph objective
// invokes it, so the tests drive the real entry point rather than importing
// internals: an "unreachable" verdict has to be a *measured* result of the
// shipped script, not an artefact of how a helper was called.
// (`import.meta.url` is not a file: URL under the jsdom test environment, so
// the path is resolved from the project root vitest runs in.)
const PROBE = resolve(process.cwd(), 'scripts/probe-walle-objective.mjs');

function runProbe(args) {
  // Async, not spawnSync: the fixture HTTPS servers live in this same test
  // process, so a synchronous child would block the event loop the server
  // needs in order to accept the connection.
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PROBE, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

/** Run the probe against a URL and parse its JSON verdict. */
async function probeJson(args) {
  const res = await runProbe([...args, '--json']);
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = null;
  }
  return { res, verdict: parsed };
}

const WALLET_UI = `<!DOCTYPE html><html><head><title>Cashu.me</title>
<script type="module" crossorigin src="/assets/index.abc123.js"></script>
<link rel="manifest" href="/manifest.json"></head>
<body><div id=q-app></div></body></html>`;

const NOT_FOUND_BODY = '404 page not found\n';

/** One HTTPS fixture server whose behaviour per path is set by the test. */
function makeServer(cert, key, route) {
  return createServer({ cert, key }, (req, res) => {
    route(req, res);
  });
}

describe('probe-walle-objective — verdicts are measured, not thrown', () => {
  let pki;

  beforeAll(() => {
    pki = makeFixturePki();
  }, 60_000);

  afterAll(() => {
    pki?.cleanup();
  });

  describe('unreachable fixture', () => {
    it('reports NOT_VALIDATABLE with a connection error, and exits 0', async () => {
      // A port nothing listens on: connect ECONNREFUSED, never an exception trace.
      const { res, verdict } = await probeJson([
        '--url',
        'https://127.0.0.1:9/',
        '--timeout', '3000',
      ]);

      expect(res.status).toBe(0);
      expect(verdict).not.toBeNull();
      expect(verdict.verdict).toBe('NOT_VALIDATABLE');
      expect(verdict.reachable).toBe(false);
      expect(verdict.error.stage).toBe('connect');
      expect(typeof verdict.error.code).toBe('string');
      expect(verdict.error.code.length).toBeGreaterThan(0);
      // A connection failure must not masquerade as an HTTP observation.
      expect(verdict.http).toBeNull();
      // The verdict must still name what was probed and when.
      expect(verdict.url).toBe('https://127.0.0.1:9/');
      expect(Number.isNaN(Date.parse(verdict.probed_at))).toBe(false);
    });
  });

  describe('self-signed fixture (the live host shape)', () => {
    let server;
    let base;

    beforeAll(async () => {
      // Mirrors walle.cashu.me: untrusted cert, and 404 for every path.
      server = makeServer(pki.selfSigned.cert, pki.selfSigned.key, (req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(NOT_FOUND_BODY);
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `https://127.0.0.1:${portOf(server)}/`;
    }, 30_000);

    afterAll(async () => {
      await new Promise((r) => server.close(r));
    });

    it('records the TLS failure as a finding, then describes what is served', async () => {
      const { res, verdict } = await probeJson([
        '--url', base,
        '--timeout', '5000',
      ]);

      expect(res.status).toBe(0);
      expect(verdict.verdict).toBe('NOT_VALIDATABLE');
      expect(verdict.reachable).toBe(false);

      // The strict pass establishes no identity, and says so by name.
      expect(verdict.tls).not.toBeNull();
      expect(verdict.tls.trusted).toBe(false);
      expect(verdict.tls.authorized_error).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
      expect(verdict.reason).toBe('the certificate does not chain to a trust anchor');

      // "Unreachable" means: no trusted origin. It does NOT mean "no answer".
      // The second, explicitly unverified pass still records the certificate
      // that is offered and the body that is returned, so a self-signed origin
      // that starts serving a wallet becomes visible instead of staying a
      // mystery.
      expect(verdict.unverified).not.toBeNull();
      expect(verdict.unverified.evidence_source).toBe('unverified-handshake');
      expect(verdict.unverified.tls.subject).toBe('TRAEFIK DEFAULT CERT');
      expect(verdict.unverified.tls.issuer).toBe('TRAEFIK DEFAULT CERT');
      expect(verdict.unverified.tls.trusted).toBe(false);
      expect(verdict.unverified.paths['/'].status).toBe(404);
      expect(verdict.unverified.paths['/'].body.shape).toBe('not_found');
      // Nothing observed without identity may be reported as architecture.
      expect(verdict.arch).toBeNull();
    });
  });

  describe('reachable fixture', () => {
    let server;
    let base;

    beforeAll(async () => {
      server = makeServer(pki.leaf.cert, pki.leaf.key, (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(WALLET_UI);
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `https://localhost:${portOf(server)}/`;
    }, 30_000);

    afterAll(async () => {
      await new Promise((r) => server.close(r));
    });

    it('reports VALIDATED and a measured architecture when the cert chains', async () => {
      const { res, verdict } = await probeJson([
        '--url', base,
        '--timeout', '5000',
        '--ca', pki.ca,
      ]);

      expect(res.status).toBe(0);
      expect(verdict.verdict).toBe('VALIDATED');
      expect(verdict.reachable).toBe(true);
      expect(verdict.tls.trusted).toBe(true);
      expect(verdict.tls.authorized_error).toBeNull();
      expect(verdict.http.status).toBe(200);
      expect(verdict.body_shape).toBe('wallet_ui');

      // Architecture is extracted from the body, not assumed.
      expect(verdict.arch).not.toBeNull();
      expect(verdict.arch.is_wallet_ui).toBe(true);
      expect(verdict.arch.title).toBe('Cashu.me');
      expect(verdict.arch.assets).toContain('/assets/index.abc123.js');
      expect(verdict.arch.manifest).toBe('/manifest.json');
    });
  });

  describe('redirect fixture', () => {
    let server;
    let base;

    beforeAll(async () => {
      server = makeServer(pki.leaf.cert, pki.leaf.key, (req, res) => {
        res.writeHead(302, { Location: 'https://example.invalid/wallet' });
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `https://localhost:${portOf(server)}/`;
    }, 30_000);

    afterAll(async () => {
      await new Promise((r) => server.close(r));
    });

    it('records the redirect target rather than following it blindly', async () => {
      const { verdict } = await probeJson([
        '--url', base,
        '--timeout', '5000',
        '--ca', pki.ca,
      ]);

      expect(verdict.reachable).toBe(true);
      expect(verdict.http.status).toBe(302);
      expect(verdict.http.location).toBe('https://example.invalid/wallet');
      expect(verdict.body_shape).toBe('redirect');
      // A redirect is a fact about the origin, not a validated wallet.
      expect(verdict.verdict).toBe('NOT_VALIDATABLE');
    });
  });

  it('fails loudly (exit 2) on a usage error, never a stack trace dump', async () => {
    const res = await runProbe(['--url', 'not-a-url', '--json']);
    expect(res.status).toBe(2);
    const v = JSON.parse(res.stdout);
    expect(v.verdict).toBe('NOT_VALIDATABLE');
    expect(v.error.stage).toBe('args');
  });
});
