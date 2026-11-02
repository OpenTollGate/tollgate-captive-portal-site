// TLS fixtures for the walle probe tests.
//
// The probe has to distinguish a *trusted* origin serving a wallet from an
// origin whose certificate does not chain to a trust anchor (the live
// `walle.cashu.me` case: Traefik's default self-signed cert). To test that
// without committing private keys, every certificate is generated at test time
// with the system `openssl`.
//
// Three artifacts are produced in a throwaway directory:
//   ca.crt          a throwaway CA — the probe is told to trust it
//   leaf.{crt,key}  a cert for localhost/127.0.0.1 signed by that CA  (trusted)
//   selfsigned.{crt,key}  a cert nothing chains to, CN=TRAEFIK DEFAULT CERT
//                         (the exact CN the live host serves)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function openssl(args) {
  execFileSync('openssl', args, { stdio: 'pipe' });
}

/**
 * Generate the fixture PKI. Returns absolute paths plus a `cleanup()`.
 */
export function makeFixturePki() {
  const dir = mkdtempSync(join(tmpdir(), 'walle-probe-pki-'));
  const p = (name) => join(dir, name);

  // CA
  openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', p('ca.key'), '-out', p('ca.crt'),
    '-days', '2', '-subj', '/CN=walle-probe-test-ca',
  ]);

  // Leaf signed by the CA, valid for localhost and 127.0.0.1
  writeFileSync(
    p('ext.cnf'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n',
  );
  openssl([
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', p('leaf.key'), '-out', p('leaf.csr'),
    '-subj', '/CN=localhost',
  ]);
  openssl([
    'x509', '-req', '-in', p('leaf.csr'),
    '-CA', p('ca.crt'), '-CAkey', p('ca.key'), '-CAcreateserial',
    '-out', p('leaf.crt'), '-days', '2', '-extfile', p('ext.cnf'),
  ]);

  // Self-signed, deliberately mimicking the live host's default certificate
  openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', p('selfsigned.key'), '-out', p('selfsigned.crt'),
    '-days', '2', '-subj', '/CN=TRAEFIK DEFAULT CERT',
  ]);

  return {
    dir,
    ca: p('ca.crt'),
    // PEM text, not paths: node:https tls options expect the certificate
    // material itself (a path is read as PEM and fails "no start line").
    leaf: {
      cert: readFileSync(p('leaf.crt'), 'utf8'),
      key: readFileSync(p('leaf.key'), 'utf8'),
    },
    selfSigned: {
      cert: readFileSync(p('selfsigned.crt'), 'utf8'),
      key: readFileSync(p('selfsigned.key'), 'utf8'),
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Resolve the port a listening server actually bound to. */
export function portOf(server) {
  const { port } = server.address();
  return port;
}
