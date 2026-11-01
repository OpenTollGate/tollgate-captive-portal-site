import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { ubusCall, setRootPassword } from '../lib/ubus';
import SchemaForm, { validateSchemaFields, type FieldSchema } from '../components/schema-form';
import { refusalInApplied } from '../lib/module-reply';
import { MIN_ADMIN_PASSWORD_LENGTH, validatePasswordChoice } from '../lib/provisional';
import ProfitShareEditor from '../components/profit-share-editor';

type FieldGroup = {
  label: string;
  keys: string[];
};

const FIELD_GROUPS: FieldGroup[] = [
  { label: 'General', keys: ['log_level', 'metric', 'step_size', 'margin', 'show_setup', 'reseller_mode'] },
  // The router's own networks (module schema v0.0.9). `private_key` is
  // write-only: the module never returns it, so this card renders it empty and
  // only ever sends a value the operator types here.
  { label: 'Private Network (management SSID)', keys: ['private_ssid', 'private_key', 'private_encryption'] },
  { label: 'Administration Access', keys: ['admin_access'] },
  { label: 'Accepted Mints', keys: ['accepted_mints'] },
  { label: 'Upstream discovery', keys: ['probe_timeout', 'probe_retry_count', 'probe_retry_delay', 'require_valid_signature', 'ignore_interfaces'] },
  { label: 'Venue Wi-Fi service', keys: ['manual_pause_seconds'] },
];

function systemSection(result: any): { name: string; hostname: string } {
  const sections = Object.entries(result?.values || {}).filter(([, value]: [string, any]) => value?.['.type'] === 'system');
  if (sections.length !== 1) throw new Error('The router did not report one system section. No hostname was saved.');
  const [key, value] = sections[0] as [string, any];
  const name = value['.name'] || key;
  if (typeof name !== 'string' || !name || typeof value.hostname !== 'string') throw new Error('The router did not report hostname settings. No hostname was saved.');
  return { name, hostname: value.hostname };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Secret values are write-only at every schema depth. Baselines and completed
// drafts omit them; pending saves retain only nonempty values the owner typed.
function withoutSecrets(fields: FieldSchema[], values: Record<string, any>, keepTyped = false, markSet?: Record<string, boolean>, path: string[] = []): Record<string, any> {
  const result = { ...values };
  for (const field of fields) {
    const value = values[field.json_key];
    const fieldPath = [...path, field.json_key];
    if (field.secret) {
      const typed = typeof value === 'string' && value.length > 0;
      if (keepTyped && typed) continue;
      if (typed && markSet) markSet[fieldPath.join('.')] = true;
      delete result[field.json_key];
    } else if (field.children?.length && field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      result[field.json_key] = withoutSecrets(field.children, value, keepTyped, markSet, fieldPath);
    } else if (field.children?.length && field.type === 'array' && Array.isArray(value)) {
      result[field.json_key] = value.map((row, index) => row && typeof row === 'object' && !Array.isArray(row)
        ? withoutSecrets(field.children!, row, keepTyped, markSet, [...fieldPath, String(index)]) : row);
    }
  }
  return result;
}

// Preserve untouched legacy values even when a newer schema tightens a bound.
// New rows/objects are validated in full; existing containers validate edits.
function changedSchemaError(fields: FieldSchema[], values: any, previous: any, secretSet: Record<string, boolean>, path: string[] = []): string | null {
  for (const field of fields) {
    const value = values?.[field.json_key];
    const before = previous?.[field.json_key];
    if (!field.editable || sameValue(value, before)) continue;
    const key = [...path, field.json_key].join('.');
    if (field.type === 'object' && field.children?.length && value && before && typeof value === 'object' && typeof before === 'object' && !Array.isArray(value) && !Array.isArray(before)) {
      const error = changedSchemaError(field.children, value, before, secretSet, [...path, field.json_key]);
      if (error) return error;
      continue;
    }
    if (field.type === 'array' && field.children?.length && Array.isArray(value) && Array.isArray(before)) {
      const strings = field.children.length === 1 && field.children[0].type === 'string';
      for (let index = 0; index < value.length; index++) {
        if (sameValue(value[index], before[index])) continue;
        if (!strings && value[index] && before[index] && typeof value[index] === 'object' && typeof before[index] === 'object' && !Array.isArray(value[index]) && !Array.isArray(before[index])) {
          const error = changedSchemaError(field.children, value[index], before[index], secretSet, [...path, field.json_key, String(index)]);
          if (error) return error;
        } else {
          const check = strings ? { ...field.children[0], json_key: key } : { ...field, json_key: key };
          const error = validateSchemaFields([check], { [key]: strings ? value[index] : [value[index]] }, secretSet);
          if (error) return error;
        }
      }
      continue;
    }
    const error = validateSchemaFields([{ ...field, json_key: key }], { [key]: value }, secretSet);
    if (error) return error;
  }
  return null;
}

function stepDescription(metric: unknown, step: unknown): string {
  if (typeof step !== 'number' || !Number.isFinite(step)) return 'not set';
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (metric === 'bytes') return `${format(step / 1048576)} MiB (${format(step)} bytes)`;
  if (metric === 'milliseconds') return `${format(step / 1000)} seconds (${format(step)} milliseconds)`;
  return `${format(step)} ${typeof metric === 'string' ? metric : 'units'}`;
}

function groupFields(schema: FieldSchema[]): { label: string; fields: FieldSchema[] }[] {
  const groups: { label: string; fields: FieldSchema[] }[] = [];
  const used = new Set<string>();

  for (const group of FIELD_GROUPS) {
    const fields: FieldSchema[] = [];
    for (const field of schema) {
      if (group.keys.includes(field.json_key)) {
        fields.push(field);
        used.add(field.json_key);
      }
      if (field.json_key === 'upstream_detector' && group.keys.some(k => k.startsWith('probe_') || k.startsWith('require_') || k.startsWith('ignore_'))) {
        fields.push(field);
        used.add(field.json_key);
      }
      if (field.json_key === 'upstream_wifi' && group.keys.includes('manual_pause_seconds')) {
        fields.push(field);
        used.add(field.json_key);
      }
    }
    if (fields.length > 0) {
      groups.push({ label: group.label, fields });
    }
  }

  const remaining = schema.filter(f => f.json_key !== 'profit_share' && !used.has(f.json_key) && f.editable);
  if (remaining.length > 0) {
    groups.push({ label: 'Other', fields: remaining });
  }

  return groups;
}

export default function Settings() {
  const [schema, setSchema] = useState<FieldSchema[]>([]);
  const [configValues, setConfigValues] = useState<Record<string, any>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, any>>({});
  // Which write-only (secret) fields have a stored value. The module reports
  // this instead of the value itself, which is what lets the card say "set"
  // without ever holding the private network's passphrase.
  const [secretSet, setSecretSet] = useState<Record<string, boolean>>({});
  const [hostname, setHostname] = useState('');
  const [currentHostname, setCurrentHostname] = useState('');
  const [activeHostname, setActiveHostname] = useState('');
  const [hostnameIssue, setHostnameIssue] = useState('');
  const [hostnameAvailable, setHostnameAvailable] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [hostnameSaving, setHostnameSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profitBusy, setProfitBusy] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [messageErrors, setMessageErrors] = useState<Record<string, boolean>>({});
  const schemaInFlight = useRef(false);
  const hostnameInFlight = useRef(false);
  const passwordInFlight = useRef(false);
  // Whether the schema-section message reports a FAILURE. It used to be
  // inferred from the message text ("does it start with 'saved'"), which fell
  // over as soon as the module started reporting what it converged onto the
  // router: a successful apply came back as "Set admin_access = …; runtime: 1
  // applied" and was rendered as an error. Tone is state, not a prefix.
  const [schemaMsgIsError, setSchemaMsgIsError] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [schemaRes, configRes, boardData, systemData] = await Promise.allSettled([
        ubusCall('tollgate', 'config_schema'),
        ubusCall('tollgate', 'config_get'),
        ubusCall('system', 'board'),
        ubusCall('uci', 'get', { config: 'system' }),
      ]);

      if (schemaRes.status !== 'fulfilled' || !schemaRes.value?.success || !Array.isArray(schemaRes.value?.data?.config)) {
        throw new Error('Settings schema is unavailable. No settings can be edited until it loads.');
      }
      if (configRes.status !== 'fulfilled' || !configRes.value?.success || !configRes.value?.data?.config || typeof configRes.value.data.config !== 'object' || Array.isArray(configRes.value.data.config)) {
        throw new Error('Configuration is unavailable. No settings can be edited until it loads.');
      }
      const fields = schemaRes.value.data.config;
      const values = withoutSecrets(fields, configRes.value.data.config);
      setSchema(fields);
      setConfigValues(values);
      setOriginalValues(values);
      setSecretSet(configRes.value.data.secret_set || {});
      setActiveHostname(boardData.status === 'fulfilled' ? boardData.value?.hostname || '' : '');
      try {
        if (systemData.status !== 'fulfilled') throw new Error('Hostname settings are unavailable. Retry loading settings before changing the hostname.');
        const section = systemSection(systemData.value);
        setHostname(section.hostname); setCurrentHostname(section.hostname);
        setHostnameAvailable(true); setHostnameIssue('');
      } catch (err: any) { setHostnameAvailable(false); setHostnameIssue(err.message); }
      setMessages({});
      setMessageErrors({});
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  function setMessage(key: string, msg: string, isError = false) {
    setMessages((prev) => ({ ...prev, [key]: msg }));
    setMessageErrors((prev) => ({ ...prev, [key]: isError }));
  }

  function handleSchemaChange(key: string, value: any) {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSchemaChanges() {
    if (schemaInFlight.current || saving || profitBusy || hostnameSaving || passwordSaving) return;
    const changed: Record<string, any> = {};
    const pending = withoutSecrets(schema, configValues, true);
    for (const key of Object.keys(pending)) {
      if (!sameValue(pending[key], originalValues[key])) {
        changed[key] = pending[key];
      }
    }

    if (Object.keys(changed).length === 0) {
      setSchemaMsgIsError(false);
      setMessage('schema', 'No changes to save');
      return;
    }

    const problem = changedSchemaError(schema.filter(field => field.json_key !== 'profit_share'), pending, originalValues, secretSet);
    if (problem) { setSchemaMsgIsError(true); setMessage('schema', problem, true); return; }

    schemaInFlight.current = true;
    setSaving(true);
    let mutationAttempted = false;
    const unconfirmed = " Some changes may already have applied. Reload settings and review before trying again.";
    try {
      const hasComplex = Object.values(changed).some(
        v => Array.isArray(v) || (typeof v === 'object' && v !== null),
      );

      let appliedMessage = '';
      if (hasComplex) {
        const fresh = await ubusCall('tollgate', 'config_get');
        if (!fresh?.success || !fresh.data?.config) throw new Error('Could not read current settings; nothing was saved.');
        const baseline = withoutSecrets(schema, fresh.data.config);
        if (Object.keys(changed).some(key => !sameValue(baseline[key], originalValues[key]))) {
          throw new Error('These settings changed elsewhere. Nothing was saved. Reload settings and review your changes.');
        }
        const merged = { ...fresh.data.config };
        for (const [key, value] of Object.entries(changed)) {
          merged[key] = value;
        }
        mutationAttempted = true;
        const res = await ubusCall('tollgate', 'config_save', {
          json: JSON.stringify(merged),
        });
        if (!res.success) {
          setSchemaMsgIsError(true);
          setMessage('schema', `Error: ${res.error || 'config save failed'}.${unconfirmed}`);
          setSaving(false);
          return;
        }
        // The wholesale path reports `applied` the same way the per-key path
        // does, so a step the module declined must be surfaced here too.
        const refused = refusalInApplied(res);
        if (refused) {
          setSchemaMsgIsError(true);
          setMessage('schema', refused + unconfirmed);
          setSaving(false);
          return;
        }
        appliedMessage = res.message || '';
      } else {
        for (const [key, value] of Object.entries(changed)) {
          mutationAttempted = true;
          const res = await ubusCall('tollgate', 'config_set', { key, value: String(value) });
          if (!res.success) {
            setSchemaMsgIsError(true);
            setMessage('schema', `Error setting ${key}: ${res.error}.${unconfirmed}`);
            setSaving(false);
            return;
          }
          const refused = refusalInApplied(res);
          if (refused) {
            setSchemaMsgIsError(true);
            setMessage('schema', refused + unconfirmed);
            setSaving(false);
            return;
          }
          // Surface what the module converged onto the router (the private
          // network's credentials and the admin-access scope apply immediately;
          // the rest is read at service start) rather than the generic reminder.
          if (res.message) {
            appliedMessage = res.message;
          }
        }
      }

      // A secret the operator just typed must not stay in the page's state (or
      // in the values a later wholesale save would resend). The field goes back
      // to empty and is marked as set, which is exactly what a reload shows.
      const nextSecretSet = { ...secretSet };
      const nextValues = withoutSecrets(schema, pending, false, nextSecretSet);
      setConfigValues(nextValues);
      setOriginalValues(nextValues);
      setSecretSet(nextSecretSet);
      setSchemaMsgIsError(false);
      setMessage('schema', appliedMessage || 'saved — restart tollgate-wrt to apply');
    } catch (err: any) {
      setSchemaMsgIsError(true);
      setMessage('schema', `Error: ${err.message}${mutationAttempted ? unconfirmed : ''}`);
    } finally {
      schemaInFlight.current = false;
      setSaving(false);
    }
  }

  async function saveHostname() {
    if (hostnameInFlight.current || saving || profitBusy || passwordSaving || !hostnameAvailable) return;
    const requested = hostname.trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(requested)) {
      setMessage('hostname', 'Use 1–63 letters, numbers or hyphens, starting and ending with a letter or number.', true); return;
    }
    hostnameInFlight.current = true; setHostnameSaving(true);
    let attempted = false;
    try {
      const fresh = systemSection(await ubusCall('uci', 'get', { config: 'system' }));
      if (fresh.hostname !== currentHostname) throw new Error('Hostname changed elsewhere. Reload settings before saving.');
      attempted = true;
      await ubusCall('uci', 'set', { config: 'system', section: fresh.name, values: { hostname: requested } });
      await ubusCall('uci', 'commit', { config: 'system' });
      const observed = systemSection(await ubusCall('uci', 'get', { config: 'system' }));
      setHostname(observed.hostname); setCurrentHostname(observed.hostname);
      if (observed.hostname !== requested) throw new Error('Hostname save was not confirmed by the router.');
      const board = await ubusCall('system', 'board').catch(() => null);
      const active = typeof board?.hostname === 'string' ? board.hostname : '';
      setActiveHostname(active);
      setMessage('hostname', active === requested ? `Hostname saved. The active hostname is ${active}.` : `Hostname saved in configuration. The active hostname is ${active || 'unavailable'}; use OpenWrt LuCI to apply system settings or reboot when convenient.`);
    } catch (err: any) {
      setMessage('hostname', `${err.message}${attempted ? ' The save may already have changed configuration; reload and review before trying again.' : ''}`, true);
    } finally { hostnameInFlight.current = false; setHostnameSaving(false); }
  }

  async function changePassword() {
    if (passwordInFlight.current || saving || profitBusy || hostnameSaving) return;
    const problem = validatePasswordChoice(newPassword, confirmPassword);
    if (problem) { setMessage('password', problem, true); return; }
    passwordInFlight.current = true; setPasswordSaving(true);
    try {
      await setRootPassword(newPassword);
      setMessage('password', 'Admin password saved. Use the new password the next time you sign in.');
    } catch (err: any) {
      setMessage('password', `Password change was not confirmed: ${err.message}. If the response was lost, the new password may already be in use.`, true);
    } finally { setNewPassword(''); setConfirmPassword(''); passwordInFlight.current = false; setPasswordSaving(false); }
  }

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner loading-spinner-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-page flex-col gap-sm">
        <p className="error-text" role="alert">{error}</p>
        <button className="btn btn-secondary btn-sm" onClick={fetchSettings}>Retry</button>
      </div>
    );
  }

  const groups = groupFields(schema);

  return (
    <div className="flex flex-col gap-md">
      <h2
        className="animate-in"
        style={{ fontSize: 'var(--font-size-large)', fontWeight: 700 }}
      >
        Settings
      </h2>

      <p className="text-dim">Configuration saves and running services can take effect at different times. Use <a href="#/maintenance">Maintenance</a> to check service status and review a restart before applying startup settings.</p>

      <ProfitShareEditor disabled={saving || hostnameSaving || passwordSaving} onBusyChange={setProfitBusy} />

      {groups.map((group, gi) => (
        <div key={group.label} className={`card animate-in-delay-${Math.min(gi + 1, 4)}`}>
          <div className="card-header">
            <div className="card-title">{group.label}</div>
          </div>
          {group.label === 'Upstream discovery' && <p className="text-dim">These probes discover other TollGate gateways. Find and join venue Wi-Fi on the WiFi page; scanning there does not change these settings.</p>}
          {group.label === 'Venue Wi-Fi service' && <p className="text-dim">Advanced connection-service settings. Use the WiFi page to select a venue network.</p>}
          {group.label === 'Accepted Mints' && <div className="text-dim" data-testid="settings-pricing-summary">
            <p>Configured guest step: {stepDescription(configValues.metric, configValues.step_size)}. Prices are per step; this preview includes unsaved edits.</p>
            {Array.isArray(configValues.accepted_mints) && configValues.accepted_mints.map((mint: any, index: number) => <p key={index}>{mint.url || `Mint ${index + 1}`}: {mint.price_per_step ?? '—'} {mint.price_unit || 'sats'} per step. Minimum purchase setting: {mint.purchase_min_steps ?? '—'} steps.</p>)}
          </div>}
          <SchemaForm
            fields={group.fields}
            values={configValues}
            onChange={handleSchemaChange}
            disabled={saving || profitBusy || hostnameSaving || passwordSaving}
            secretSet={secretSet}
          />
        </div>
      ))}

      {groups.length > 0 && (
        <div className="flex items-center gap-sm animate-in-delay-3">
          <button className="btn btn-primary btn-sm" onClick={saveSchemaChanges} disabled={saving || profitBusy || hostnameSaving || passwordSaving}>
            {saving ? 'Saving…' : 'Save All Changes'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={fetchSettings} disabled={saving || profitBusy || hostnameSaving || passwordSaving}>Reload settings</button>
          {messages.schema &&
            (schemaMsgIsError ? (
              <span className="error-text" id="schema-message" role="alert">{messages.schema}</span>
            ) : (
              <span className="success-text" id="schema-message" role="status">{messages.schema}</span>
            ))}
        </div>
      )}

      <div className="card animate-in-delay-4">
        <div className="card-header">
          <div className="card-title">Hostname</div>
        </div>
        <div className="flex flex-col gap-sm">
          <label className="input-label" htmlFor="settings-hostname">Hostname</label>
          <input
            id="settings-hostname"
            type="text"
            className="input"
            value={hostname}
            disabled={!hostnameAvailable || hostnameSaving || saving || profitBusy || passwordSaving}
            onInput={(e) => setHostname((e.target as HTMLInputElement).value)}
          />
          <p className="text-dim">Active hostname: {activeHostname || 'unavailable'}. This control saves system configuration; restarting TollGate does not apply the system hostname.</p>
          {hostnameIssue && <p className="error-text" role="alert">{hostnameIssue}</p>}
          <div className="flex items-center gap-sm">
            <button className="btn btn-primary btn-sm" onClick={saveHostname} disabled={!hostnameAvailable || hostname === currentHostname || hostnameSaving || saving || profitBusy || passwordSaving}>
              {hostnameSaving ? 'Saving hostname…' : 'Save hostname'}
            </button>
            {messages.hostname &&
              <span className={messageErrors.hostname ? 'error-text' : 'success-text'} role={messageErrors.hostname ? 'alert' : 'status'}>{messages.hostname}</span>}
          </div>
        </div>
      </div>

      <div className="card animate-in-delay-4">
        <div className="card-header">
          <div className="card-title">Admin Password</div>
        </div>
        <div className="flex flex-col gap-sm">
          <div className="input-group">
            <label className="input-label" htmlFor="settings-password">New Password</label>
            <input
              id="settings-password"
              type="password"
              autoComplete="new-password"
              className="input"
              value={newPassword}
              disabled={passwordSaving || saving || profitBusy || hostnameSaving}
              onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
              placeholder="Enter new password"
            />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="settings-password-confirm">Confirm Password</label>
            <input
              id="settings-password-confirm"
              type="password"
              autoComplete="new-password"
              className="input"
              value={confirmPassword}
              disabled={passwordSaving || saving || profitBusy || hostnameSaving}
              onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="Confirm new password"
            />
          </div>
          <p className="text-dim">Use at least {MIN_ADMIN_PASSWORD_LENGTH} characters. This changes the root administrator password; your next sign-in uses the new password.</p>
          <div className="flex items-center gap-sm">
            <button
              className="btn btn-primary btn-sm"
              onClick={changePassword}
              disabled={!newPassword || !confirmPassword || passwordSaving || saving || profitBusy || hostnameSaving}
            >
              {passwordSaving ? 'Changing…' : 'Change'}
            </button>
            {messages.password &&
              <span className={messageErrors.password ? 'error-text' : 'success-text'} role={messageErrors.password ? 'alert' : 'status'}>{messages.password}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
