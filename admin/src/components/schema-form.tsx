import { useState, useCallback } from 'preact/hooks';

export interface FieldSchema {
  name: string;
  type: string;
  description?: string;
  default?: any;
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  children?: FieldSchema[];
  json_key: string;
  editable: boolean;
}

interface SchemaFormProps {
  fields: FieldSchema[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  disabled?: boolean;
}

function SchemaField({
  schema,
  value,
  onChange,
  disabled,
  depth,
}: {
  schema: FieldSchema;
  value: any;
  onChange: (key: string, value: any) => void;
  disabled: boolean;
  depth: number;
}) {
  if (schema.type === 'object' && schema.children?.length) {
    return (
      <div className={depth > 0 ? 'schema-nested' : ''}>
        {schema.children.map((child) => (
          <SchemaField
            key={child.json_key}
            schema={child}
            value={value?.[child.json_key]}
            onChange={(_, childVal) => {
              const updated = { ...(value || {}), [child.json_key]: childVal };
              onChange(schema.json_key, updated);
            }}
            disabled={disabled}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  if (schema.type === 'array' && schema.children?.length) {
    const items: any[] = Array.isArray(value) ? value : [];
    const childSchema = schema.children[0];

    return (
      <div className="schema-array">
        <div className="input-group">
          <label className="input-label">
            {schema.description || schema.name}
            {schema.required && <span className="required-mark">*</span>}
          </label>
        </div>
        {items.map((item, idx) => (
          <div key={idx} className="schema-array-item">
            <div className="schema-array-item-header">
              <span className="text-muted" style={{ fontSize: 'var(--font-size-xsmall)' }}>
                #{idx + 1}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--font-size-xsmall)' }}
                onClick={() => {
                  const next = items.filter((_: any, i: number) => i !== idx);
                  onChange(schema.json_key, next.length ? next : undefined);
                }}
                disabled={disabled}
              >
                Remove
              </button>
            </div>
            {schema.children!.map((child) => (
              <SchemaField
                key={child.json_key}
                schema={child}
                value={item?.[child.json_key]}
                onChange={(_, childVal) => {
                  const next = [...items];
                  next[idx] = { ...(next[idx] || {}), [child.json_key]: childVal };
                  onChange(schema.json_key, next);
                }}
                disabled={disabled}
                depth={depth + 1}
              />
            ))}
          </div>
        ))}
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: '0.3rem' }}
          onClick={() => {
            const newItem: Record<string, any> = {};
            schema.children!.forEach((child) => {
              if (child.default !== undefined) newItem[child.json_key] = child.default;
            });
            onChange(schema.json_key, [...items, newItem]);
          }}
          disabled={disabled}
        >
          + Add {schema.name}
        </button>
      </div>
    );
  }

  if (schema.type === 'array' && schema.children?.length === 1 && schema.children[0].type === 'string') {
    const items: string[] = Array.isArray(value) ? value : [];
    return (
      <div className="schema-array">
        <div className="input-group">
          <label className="input-label">
            {schema.description || schema.name}
            {schema.required && <span className="required-mark">*</span>}
          </label>
        </div>
        {items.map((item, idx) => (
          <div key={idx} className="schema-array-item" style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={item}
              disabled={!schema.editable || disabled}
              onInput={(e) => {
                const next = [...items];
                next[idx] = (e.target as HTMLInputElement).value;
                onChange(schema.json_key, next);
              }}
            />
            <button
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.15rem 0.5rem' }}
              onClick={() => {
                const next = items.filter((_: any, i: number) => i !== idx);
                onChange(schema.json_key, next.length ? next : undefined);
              }}
              disabled={disabled}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: '0.3rem' }}
          onClick={() => onChange(schema.json_key, [...items, ''])}
          disabled={disabled}
        >
          + Add
        </button>
      </div>
    );
  }

  const inputId = `field-${schema.json_key}`;

  return (
    <div className="input-group">
      <label className="input-label" htmlFor={inputId}>
        {schema.description || schema.name}
        {schema.required && <span className="required-mark">*</span>}
        {!schema.editable && <span className="text-muted" style={{ marginLeft: '0.3rem', fontSize: 'var(--font-size-xsmall)' }}>(read-only)</span>}
      </label>

      {schema.enum ? (
        <select
          id={inputId}
          className="input"
          value={value ?? schema.default ?? ''}
          disabled={!schema.editable || disabled}
          onChange={(e) => onChange(schema.json_key, (e.target as HTMLSelectElement).value)}
          style={{ appearance: 'none', paddingRight: '2rem' }}
        >
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : schema.type === 'bool' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value ?? schema.default ?? false}
            disabled={!schema.editable || disabled}
            onChange={(e) => onChange(schema.json_key, (e.target as HTMLInputElement).checked)}
            style={{ width: '18px', height: '18px' }}
          />
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-dim)' }}>
            {(value ?? schema.default) ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      ) : (
        <input
          id={inputId}
          type={schema.type === 'uint64' || schema.type === 'int' || schema.type === 'float64' ? 'number' : 'text'}
          className="input"
          value={value ?? schema.default ?? ''}
          placeholder={schema.default !== undefined ? String(schema.default) : ''}
          disabled={!schema.editable || disabled}
          min={schema.min}
          max={schema.max}
          step={schema.type === 'float64' ? '0.01' : undefined}
          onInput={(e) => {
            let val: any = (e.target as HTMLInputElement).value;
            if (schema.type === 'uint64' || schema.type === 'int') {
              val = val === '' ? undefined : parseInt(val, 10);
            } else if (schema.type === 'float64') {
              val = val === '' ? undefined : parseFloat(val);
            }
            onChange(schema.json_key, val);
          }}
        />
      )}
    </div>
  );
}

export default function SchemaForm({ fields, values, onChange, disabled }: SchemaFormProps) {
  return (
    <div className="flex flex-col gap-sm">
      {fields.map((field) => (
        <SchemaField
          key={field.json_key}
          schema={field}
          value={values[field.json_key]}
          onChange={onChange}
          disabled={disabled || false}
          depth={0}
        />
      ))}
    </div>
  );
}
