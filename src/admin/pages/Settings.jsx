import { useState, useEffect } from 'react';
import { ubusCall } from '../lib/ubus';
import SchemaForm from '../lib/schema-form';
import './Settings.scss';

export default function Settings() {
  const [schema, setSchema] = useState([]);
  const [values, setValues] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([
          ubusCall('tollgate', 'config_schema'),
          ubusCall('tollgate', 'config_get'),
        ]);
        setSchema(s?.fields || s || []);
        const current = c?.config || c || {};
        setValues({ ...current });
        setOriginal({ ...current });
      } catch (err) {
        setFeedback({ type: 'error', message: err.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const changed = Object.keys(values).filter(
        (k) => JSON.stringify(values[k]) !== JSON.stringify(original[k])
      );
      for (const key of changed) {
        await ubusCall('tollgate', 'config_set', { key, value: values[key] });
      }
      const fullConfig = {};
      for (const f of schema) {
        fullConfig[f.json_key] = values[f.json_key] ?? f.default;
      }
      await ubusCall('tollgate', 'config_save', { json: JSON.stringify(fullConfig) });
      setOriginal({ ...values });
      setFeedback({ type: 'success', message: 'Settings saved successfully.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-page-loading"><span className="spinner big"></span></div>;
  }

  return (
    <div className="admin-settings">
      <h2>Settings</h2>

      {feedback && (
        <div className={feedback.type === 'error' ? 'admin-error' : 'admin-success'}>
          {feedback.message}
        </div>
      )}

      <SchemaForm schema={schema} values={values} onChange={handleChange} />

      <div className="admin-settings-actions">
        <button className="cta" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
