import { useState, useEffect, useCallback } from 'preact/hooks';
import { ubusCall } from '../lib/ubus';
import SchemaForm, { type FieldSchema } from '../components/schema-form';

type FieldGroup = {
  label: string;
  keys: string[];
};

const FIELD_GROUPS: FieldGroup[] = [
  { label: 'General', keys: ['log_level', 'metric', 'step_size', 'margin', 'show_setup', 'reseller_mode', 'manual_pause_seconds'] },
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
  const [hostname, setHostname] = useState('');
  const [currentHostname, setCurrentHostname] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});

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

  async function saveSchemaChanges() {
    const changed: Record<string, any> = {};
    for (const key of Object.keys(configValues)) {
      if (JSON.stringify(configValues[key]) !== JSON.stringify(originalValues[key])) {
        changed[key] = configValues[key];
      }
    }

    if (Object.keys(changed).length === 0) {
      setMessage('schema', 'No changes to save');
      return;
    }

    setSaving(true);
    try {
      const hasComplex = Object.values(changed).some(
        v => Array.isArray(v) || (typeof v === 'object' && v !== null),
      );

      if (hasComplex) {
        const merged = { ...originalValues };
        for (const [key, value] of Object.entries(changed)) {
          merged[key] = value;
        }
        const res = await ubusCall('tollgate', 'config_save', {
          json: JSON.stringify(merged),
        });
        if (!res.success) {
          setMessage('schema', `Error: ${res.error || 'config save failed'}`);
          setSaving(false);
          return;
        }
      } else {
        for (const [key, value] of Object.entries(changed)) {
          const res = await ubusCall('tollgate', 'config_set', { key, value: String(value) });
          if (!res.success) {
            setMessage('schema', `Error setting ${key}: ${res.error}`);
            setSaving(false);
            return;
          }
        }
      }
      setOriginalValues({ ...configValues });
      setMessage('schema', 'saved — restart tollgate-wrt to apply');
    } catch (err: any) {
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
          />
        </div>
      ))}

      {groups.length > 0 && (
        <div className="flex items-center gap-sm animate-in-delay-3">
          <button className="btn btn-primary btn-sm" onClick={saveSchemaChanges} disabled={saving}>
            {saving ? 'Saving…' : 'Save All Changes'}
          </button>
          {messages.schema &&
            (messages.schema === 'saved — restart tollgate-wrt to apply' || messages.schema.startsWith('saved') ? (
              <span className="success-text">{messages.schema}</span>
            ) : (
              <span className="error-text">{messages.schema}</span>
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
