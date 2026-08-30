import { useState } from 'react';

function SchemaField({ field, value, onChange }) {
  const [collapsed, setCollapsed] = useState(true);

  if (!field.editable) {
    return (
      <div className="schema-field schema-field-readonly">
        <label>{field.description || field.json_key}</label>
        <div className="schema-field-readonly-value">
          {value !== undefined ? String(value) : String(field.default ?? '')}
        </div>
      </div>
    );
  }

  if (field.enum && field.enum.length > 0) {
    return (
      <div className="schema-field">
        <label>{field.description || field.json_key}</label>
        <select value={value ?? field.default ?? ''} onChange={(e) => onChange(field.json_key, e.target.value)}>
          <option value="">-- select --</option>
          {field.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'bool') {
    return (
      <div className="schema-field schema-field-bool">
        <label>{field.description || field.json_key}</label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={!!(value ?? field.default)}
            onChange={(e) => onChange(field.json_key, e.target.checked)}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>
    );
  }

  if (field.type === 'uint64' || field.type === 'float64') {
    return (
      <div className="schema-field">
        <label>{field.description || field.json_key}</label>
        <input
          type="number"
          value={value ?? field.default ?? ''}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          step={field.type === 'float64' ? 'any' : '1'}
          onChange={(e) => {
            const v = e.target.value;
            onChange(field.json_key, v === '' ? '' : Number(v));
          }}
        />
      </div>
    );
  }

  if (field.type === 'array' || field.type === 'object') {
    return (
      <div className="schema-field schema-field-collapsible">
        <div className="schema-field-collapsible-header" onClick={() => setCollapsed(!collapsed)}>
          <label>{field.description || field.json_key}</label>
          <span className="schema-field-collapse-icon">{collapsed ? '+' : '-'}</span>
        </div>
        {!collapsed && (
          <textarea
            value={value !== undefined ? (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) : JSON.stringify(field.default, null, 2)}
            onChange={(e) => {
              try {
                onChange(field.json_key, JSON.parse(e.target.value));
              } catch {
                onChange(field.json_key, e.target.value);
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="schema-field">
      <label>{field.description || field.json_key}</label>
      <input
        type="text"
        value={value ?? field.default ?? ''}
        onChange={(e) => onChange(field.json_key, e.target.value)}
      />
    </div>
  );
}

export default function SchemaForm({ schema, values, onChange }) {
  if (!schema || !schema.length) return null;

  return (
    <div className="schema-form">
      {schema.map((field) => (
        <SchemaField
          key={field.json_key}
          field={field}
          value={values[field.json_key]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
