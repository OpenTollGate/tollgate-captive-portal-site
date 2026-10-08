/**
 * The module reports what it converged onto the router as `applied` on BOTH
 * reply paths — `config_set` and the wholesale `config_save`. `refused` means
 * it declined the value (an `admin_access` naming a bridge this router does
 * not have, a private-network credential outside its bounds) and `failed`
 * means the step did not land; neither is a save the operator can be told
 * succeeded. `warning` is optional, so it must not be the condition, and
 * every entry is inspected rather than only the first one: the board's own
 * failure was rendering a declined step as a green save.
 *
 * Shared by the Settings page and the WiFi page's private-radio edit — the
 * WiFi page used not to read `applied` at all, so a refused passphrase came
 * back rendered as "saved to both private radios".
 */
export function refusalInApplied(res: any): string | null {
  const applied = res?.data?.applied;
  if (!Array.isArray(applied)) return null;
  for (const entry of applied) {
    if (entry?.status === 'refused') {
      return `Refused: ${entry.warning || entry.detail || 'the module declined this change'}`;
    }
    if (entry?.status === 'failed') {
      return `Failed: ${entry.warning || entry.detail || 'the module could not apply this change'}`;
    }
  }
  return null;
}
