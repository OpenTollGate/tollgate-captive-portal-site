/**
 * The install-time provisional credentials.
 *
 * The module's packaging/files/etc/uci-defaults/99-tollgate-setup runs from the
 * package manager with no controlling terminal, so an operator can only choose
 * the router's admin password by handing it in the environment
 * (`TOLLGATE_ADMIN_PASSWORD`). When they do not, the module installs a FIXED
 * default (`TollGate`) and records that FACT — never the value — in marker
 * files:
 *
 *   /etc/tollgate/admin-credential-provisional
 *   /etc/tollgate/private-wifi-credential-provisional
 *
 * The markers are world-readable and deliberately secret-free. Their presence is
 * the contract "this credential is the package default, the owner has not chosen
 * one", and their absence is "the credential is the owner's own choice". A
 * router left on the default would otherwise be reachable with a value anyone
 * can read off the package.
 *
 * This module is the client half: PURE logic, no DOM, no `location`, no ubus,
 * so both the gate and the password policy are unit-testable without a browser.
 * The board reads the markers through the `tollgate auth_status` probe (see
 * lib/ubus.ts) and clears them through `admin_credential_setup`.
 */

/**
 * The marker path, exactly as the module writes it
 * (99-tollgate-setup: ADMIN_PROVISIONAL_MARKER). Exported so the UI can name it
 * and so a test can pin the two halves to the same path.
 */
export const PROVISIONAL_MARKER_PATH =
  '/etc/tollgate/admin-credential-provisional';

/**
 * The private (management) WiFi companion marker
 * (99-tollgate-setup: PRIVATE_WIFI_PROVISIONAL_MARKER).
 */
export const PRIVATE_WIFI_PROVISIONAL_MARKER_PATH =
  '/etc/tollgate/private-wifi-credential-provisional';

/**
 * A generated credential the owner is expected to replace. The router enforces
 * no minimum of its own (BusyBox `passwd` takes anything). This bound matches
 * the WPA2-PSK floor the same board applies to the private network's
 * credentials, so the board does not hold the owner to a STRICTER rule than it
 * states anywhere else.
 */
export const MIN_ADMIN_PASSWORD_LENGTH = 8;

/** The credential facts the pre-auth probe reports (subset of CredentialStatus). */
export interface ProvisionalCredential {
  /** True only when the router answered that the ADMIN marker stands. */
  provisional?: boolean;
  /** True only when the router answered that the private-WiFi marker stands. */
  privateWifiProvisional?: boolean;
}

/**
 * The forced-choice gate. Fails CLOSED in the only direction the contract
 * allows: a router that ANSWERED "a marker stands" keeps the board shut until
 * the owner chooses their own credentials. A router that could not be asked at
 * all (both flags absent, or `state: unknown`) is NOT treated as provisional —
 * otherwise an older package, a broken plugin or a flapping link would strand a
 * correctly provisioned owner on the forced screen forever, which is a worse
 * failure than the one being fixed.
 */
export function requiresPasswordChoice(
  credential?: ProvisionalCredential | null
): boolean {
  return (
    credential?.provisional === true ||
    credential?.privateWifiProvisional === true
  );
}

/**
 * True when the private (management) WiFi key is still the package default, so
 * the first-run screen must REQUIRE a WiFi passphrase (the admin password is
 * always required there). A router that could not be asked is `false` — the
 * WiFi field stays optional, never a hard block.
 */
export function requiresWifiChoice(
  credential?: ProvisionalCredential | null
): boolean {
  return credential?.privateWifiProvisional === true;
}

/**
 * The new-password policy, as a pure function: '' when the pair is acceptable,
 * otherwise the sentence to show. The order of the checks is the order the
 * owner should read them in — an empty password is "enter one", never
 * "they do not match".
 */
export function validatePasswordChoice(
  password: string,
  confirm: string
): string {
  if (password === '') {
    return 'Enter a new password';
  }
  if (password.trim() === '') {
    return 'The new password cannot be only spaces';
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`;
  }
  if (password !== confirm) {
    return 'The two passwords do not match';
  }
  return '';
}

/** WPA2-PSK bounds. The router enforces the same pair (`weak-wifi-passphrase`). */
export const MIN_WIFI_PASSPHRASE_LENGTH = 8;
export const MAX_WIFI_PASSPHRASE_LENGTH = 63;

/**
 * The management-WiFi passphrase policy: '' when acceptable, otherwise the
 * sentence to show. An EMPTY value is acceptable — leaving the field blank means
 * "keep the installed key", which is the router's contract too.
 *
 * The bounds are checked here because the router's own refusal arrives only
 * AFTER the owner has typed and submitted: the reply says the passphrase was
 * rejected, which is a worse way to learn it.
 */
export function validateWifiPassphrase(passphrase: string): string {
  if (passphrase === '') {
    return '';
  }
  if (passphrase.length < MIN_WIFI_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_WIFI_PASSPHRASE_LENGTH} characters for the WiFi password`;
  }
  if (passphrase.length > MAX_WIFI_PASSPHRASE_LENGTH) {
    return `Use at most ${MAX_WIFI_PASSPHRASE_LENGTH} characters for the WiFi password`;
  }
  return '';
}
