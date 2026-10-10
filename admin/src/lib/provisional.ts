/**
 * The install-time provisional admin credential.
 *
 * The module's packaging/files/etc/uci-defaults/99-tollgate-setup runs from the
 * package manager with no controlling terminal, so an operator can only choose
 * the router's admin password by handing it in the environment
 * (`TOLLGATE_ADMIN_PASSWORD`). When they do not, the module MINTS one and
 * records that FACT — never the value — in a marker file:
 *
 *   /etc/tollgate/admin-credential-provisional
 *
 * The marker is world-readable and deliberately secret-free. Its presence is
 * the contract "this credential was generated, the owner has not chosen one",
 * and its absence is "the credential is the operator's own choice". Nothing
 * consumed it before this module: a router whose generated password was printed
 * once into a log — a log the next full-setup run truncates — stayed on a
 * generated credential forever.
 *
 * This module is the client half: PURE logic, no DOM, no `location`, no ubus,
 * so both the gate and the password policy are unit-testable without a browser.
 * The board reads the marker through the `tollgate auth_status` probe (see
 * lib/ubus.ts) and drops it with `tollgate admin_credential_claim`.
 */

/**
 * The marker path, exactly as the module writes it
 * (99-tollgate-setup: ADMIN_PROVISIONAL_MARKER). Exported so the UI can name it
 * and so a test can pin the two halves to the same path.
 */
export const PROVISIONAL_MARKER_PATH =
  '/etc/tollgate/admin-credential-provisional';

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
  /** True only when the router answered that the marker stands. */
  provisional?: boolean;
}

/**
 * The forced-choice gate. Fails CLOSED in the only direction the contract
 * allows: a router that ANSWERED "the marker stands" keeps the board shut until
 * the owner chooses a password. A router that could not be asked at all
 * (`provisional` absent, or `state: unknown`) is NOT treated as provisional —
 * otherwise an older package, a broken plugin or a flapping link would strand a
 * correctly provisioned owner on the forced screen forever, which is a worse
 * failure than the one being fixed.
 */
export function requiresPasswordChoice(
  credential?: ProvisionalCredential | null
): boolean {
  return credential?.provisional === true;
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
