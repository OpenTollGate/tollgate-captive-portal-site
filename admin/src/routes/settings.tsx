import { useState, useEffect, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import SchemaForm, { type FieldSchema } from '../components/schema-form';

type FieldGroup = {
  label: string;
  keys: string[];
};

const FIELD_GROUPS: FieldGroup[] = [
  { label: 'General', keys: ['log_level', 'metric', 'step_size', 'margin', 'show_setup', 'reseller_mode', 'manual_pause_seconds'] },
  // The router's own networks (module schema v0.0.9). `private_key` is
  // write-only: the module never returns it, so this card renders it empty and
  // only ever sends a value the operator types here.
  { label: 'Private Network (management SSID)', keys: ['private_ssid', 'private_key', 'private_encryption'] },
  { label: 'Administration Access', keys: ['admin_access'] },
  { label: 'Accepted Mints', keys: ['accepted_mints'] },
  { label: 'Profit Share', keys: ['profit_share'] },
  { label: 'Upstream Detector', keys: ['probe_timeout', 'probe_retry_count', 'probe_retry_delay', 'require_valid_signature', 'ignore_interfaces'] },
];

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

  const remaining = schema.filter(f => !used.has(f.json_key) && f.editable);
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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  // Whether the schema-section message reports a FAILURE. It used to be
  // inferred from the message text ("does it start with 'saved'"), which fell
  // over as soon as the module started reporting what it converged onto the
  // router: a successful apply came back as "Set admin_access = …; runtime: 1
  // applied" and was rendered as an error. Tone is state, not a prefix.
  const [schemaMsgIsError, setSchemaMsgIsError] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const [schemaRes, configRes, boardData] = await Promise.allSettled([
        ubusCall('tollgate', 'config_schema'),
        ubusCall('tollgate', 'config_get'),
        ubusCall('system', 'board'),
      ]);

      if (schemaRes.status === 'fulfilled' && schemaRes.value?.data?.config) {
        setSchema(schemaRes.value.data.config);
      }

      if (configRes.status === 'fulfilled' && configRes.value?.data?.config) {
        setConfigValues(configRes.value.data.config);
        setOriginalValues(configRes.value.data.config);
      }
      if (configRes.status === 'fulfilled' && configRes.value?.data?.secret_set) {
        setSecretSet(configRes.value.data.secret_set);
      }

      if (boardData.status === 'fulfilled' && boardData.value?.hostname) {
        setHostname(boardData.value.hostname);
        setCurrentHostname(boardData.value.hostname);
      }

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

  function setMessage(key: string, msg: string) {
    setMessages((prev) => ({ ...prev, [key]: msg }));
    setTimeout(() => {
      setMessages((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 3000);
  }

  function handleSchemaChange(key: string, value: any) {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * The module reports what it converged onto the router as `applied` on BOTH
   * reply paths — `config_set` and the wholesale `config_save`. `refused` means
   * it declined the value (for example an admin_access naming a bridge this
   * router does not have) and `failed` means the step did not land; neither is a
   * save the operator can be told succeeded. `warning` is optional, so it must
   * not be the condition, and every entry must be inspected rather than the
   * first one: the board's own failure was rendering a declined step as a green
   * save.
   */
  function refusalInApplied(res: any): string | null {
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

  async function saveSchemaChanges() {
    const changed: Record<string, any> = {};
    const secretKeys = schema.filter((f) => f.secret).map((f) => f.json_key);
    for (const key of Object.keys(configValues)) {
      if (JSON.stringify(configValues[key]) !== JSON.stringify(originalValues[key])) {
        changed[key] = configValues[key];
      }
    }

    if (Object.keys(changed).length === 0) {
      setSchemaMsgIsError(false);
      setMessage('schema', 'No changes to save');
      return;
    }

    setSaving(true);
    try {
      const hasComplex = Object.values(changed).some(
        v => Array.isArray(v) || (typeof v === 'object' && v !== null),
      );

      let appliedMessage = '';
      if (hasComplex) {
        const merged = { ...originalValues };
        for (const [key, value] of Object.entries(changed)) {
          merged[key] = value;
        }
        const res = await ubusCall('tollgate', 'config_save', {
          json: JSON.stringify(merged),
        });
        if (!res.success) {
          setSchemaMsgIsError(true);
          setMessage('schema', `Error: ${res.error || 'config save failed'}`);
          setSaving(false);
          return;
        }
        // The wholesale path reports `applied` the same way the per-key path
        // does, so a step the module declined must be surfaced here too.
        const refused = refusalInApplied(res);
        if (refused) {
          setSchemaMsgIsError(true);
          setMessage('schema', refused);
          setSaving(false);
          return;
        }
        appliedMessage = res.message || '';
      } else {
        for (const [key, value] of Object.entries(changed)) {
          const res = await ubusCall('tollgate', 'config_set', { key, value: String(value) });
          if (!res.success) {
            setSchemaMsgIsError(true);
            setMessage('schema', `Error setting ${key}: ${res.error}`);
            setSaving(false);
            return;
          }
          const refused = refusalInApplied(res);
          if (refused) {
            setSchemaMsgIsError(true);
            setMessage('schema', refused);
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
      const nextValues = { ...configValues };
      const nextSecretSet = { ...secretSet };
      for (const key of Object.keys(changed)) {
        if (secretKeys.includes(key)) {
          delete nextValues[key];
          nextSecretSet[key] = String(changed[key]).length > 0;
        }
      }
      setConfigValues(nextValues);
      setOriginalValues(nextValues);
      setSecretSet(nextSecretSet);
      setSchemaMsgIsError(false);
      setMessage('schema', appliedMessage || 'saved — restart tollgate-wrt to apply');
    } catch (err: any) {
      setSchemaMsgIsError(true);
      setMessage('schema', `Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveHostname() {
    try {
      await ubusCall('uci', 'set', { config: 'system', section: '@system[0]', values: { hostname } });
      await ubusCall('uci', 'commit', { config: 'system' });
      setCurrentHostname(hostname);
      setMessage('hostname', 'saved');
    } catch (err: any) {
      setMessage('hostname', `Error: ${err.message}`);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      setMessage('password', 'Passwords do not match');
      return;
    }
    if (newPassword.length < 4) {
      setMessage('password', 'Password too short');
      return;
    }
    try {
      await ubusCall('system', 'password_set', { password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('password', 'saved');
    } catch (err: any) {
      setMessage('password', `Error: ${err.message}`);
    }
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
        <p className="error-text">{error}</p>
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

      {groups.map((group, gi) => (
        <div key={group.label} className={`card animate-in-delay-${Math.min(gi + 1, 4)}`}>
          <div className="card-header">
            <div className="card-title">{group.label}</div>
          </div>
          <SchemaForm
            fields={group.fields}
            values={configValues}
            onChange={handleSchemaChange}
            disabled={saving}
            secretSet={secretSet}
          />
        </div>
      ))}

      {groups.length > 0 && (
        <div className="flex items-center gap-sm animate-in-delay-3">
          <button className="btn btn-primary btn-sm" onClick={saveSchemaChanges} disabled={saving}>
            {saving ? 'Saving…' : 'Save All Changes'}
          </button>
          {messages.schema &&
            (schemaMsgIsError ? (
              <span className="error-text" id="schema-message">{messages.schema}</span>
            ) : (
              <span className="success-text" id="schema-message">{messages.schema}</span>
            ))}
        </div>
      )}

      <div className="card animate-in-delay-4">
        <div className="card-header">
          <div className="card-title">Hostname</div>
        </div>
        <div className="flex flex-col gap-sm">
          <input
            type="text"
            className="input"
            value={hostname}
            onInput={(e) => setHostname((e.target as HTMLInputElement).value)}
          />
          <div className="flex items-center gap-sm">
            <button className="btn btn-primary btn-sm" onClick={saveHostname} disabled={hostname === currentHostname}>
              Save
            </button>
            {messages.hostname &&
              (messages.hostname === 'saved' ? (
                <span className="success-text">{messages.hostname}</span>
              ) : (
                <span className="error-text">{messages.hostname}</span>
              ))}
          </div>
        </div>
      </div>

      <div className="card animate-in-delay-4">
        <div className="card-header">
          <div className="card-title">Admin Password</div>
        </div>
        <div className="flex flex-col gap-sm">
          <div className="input-group">
            <label className="input-label">New Password</label>
            <input
              type="password"
              className="input"
              value={newPassword}
              onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
              placeholder="Enter new password"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Confirm Password</label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="Confirm new password"
            />
          </div>
          <div className="flex items-center gap-sm">
            <button
              className="btn btn-primary btn-sm"
              onClick={changePassword}
              disabled={!newPassword || !confirmPassword}
            >
              Change
            </button>
            {messages.password &&
              (messages.password === 'saved' ? (
                <span className="success-text">{messages.password}</span>
              ) : (
                <span className="error-text">{messages.password}</span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
