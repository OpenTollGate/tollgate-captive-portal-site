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
  /** Write-only: stored values are withheld by the module. */
  secret?: boolean;
}

interface SchemaFormProps {
  fields: FieldSchema[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  disabled?: boolean;
  secretSet?: Record<string, boolean>;
}

const numeric = (type: string) => ['uint64', 'int', 'float64'].includes(type);
const stringArray = (schema: FieldSchema) => schema.type === 'array'
  && schema.children?.length === 1 && schema.children[0].type === 'string' && !schema.children[0].json_key;
const unsupportedContainer = (schema: FieldSchema) => ['array', 'object'].includes(schema.type) && !schema.children?.length;
const fieldLabel = (schema: FieldSchema) => schema.description || schema.name || schema.json_key;

// Go time.Duration is encoded as numeric nanoseconds by config_get/config_save.
// The schema alone uses strings such as "10s" for defaults. Keep that distinction
// at the input boundary so editing a duration never writes a JSON string.
function wholeNanoseconds(candidate: number): number | null {
  if (!Number.isFinite(candidate)) return null;
  const rounded = Math.round(candidate);
  if (!Number.isSafeInteger(rounded)) return null;
  const tolerance = Math.max(1, Math.abs(candidate)) * Number.EPSILON * 4;
  return Math.abs(candidate - rounded) <= tolerance ? rounded : null;
}

function durationNanoseconds(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || value.length > 128) return null;
  if (value === '0') return 0;
  const sign = value.startsWith('-') ? -1 : 1;
  const body = /^[+-]/.test(value) ? value.slice(1) : value;
  const units: Record<string, number> = { ns: 1, us: 1e3, 'µs': 1e3, 'μs': 1e3, ms: 1e6, s: 1e9, m: 60e9, h: 3600e9 };
  const part = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/gy;
  let offset = 0;
  let total = 0;
  while (offset < body.length) {
    const match = part.exec(body);
    if (!match || match.index !== offset) return null;
    total += Number(match[1]) * units[match[2]];
    offset = part.lastIndex;
  }
  return offset > 0 ? wholeNanoseconds(sign * total) : null;
}

/** Validate the same effective values the renderer displays, before any writes. */
export function validateSchemaFields(
  fields: FieldSchema[],
  values: Record<string, any>,
  secretSet: Record<string, boolean> = {},
): string | null {
  function validate(schema: FieldSchema, supplied: any, path: string[], label = fieldLabel(schema)): string | null {
    if (!schema.editable || unsupportedContainer(schema)) return null;
    const value = supplied ?? schema.default;
    if (schema.secret && (value === undefined || value === '')
      && (secretSet[path.join('.')] || secretSet[schema.json_key])) return null;
    const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
    if (empty) {
      if (schema.required) return `${label} is required.`;
      if ((numeric(schema.type) || schema.type === 'duration') && supplied === '') return `${label} must be a number.`;
      return null;
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) return `${label} must be a list.`;
      // Required means the list must be present. An explicit [] is distinct
      // from an omitted setting; collection-specific policy stays with the module.
      for (let index = 0; index < value.length; index++) {
        if (stringArray(schema)) {
          if (typeof value[index] !== 'string') return `${label} ${index + 1} must be text.`;
          const error = validate(schema.children![0], value[index], [...path, String(index)], `${label} ${index + 1}`);
          if (error) return error;
        } else {
          if (!value[index] || typeof value[index] !== 'object' || Array.isArray(value[index])) return `${label} ${index + 1} must be an object.`;
          for (const child of schema.children || []) {
            const error = validate(child, value[index][child.json_key], [...path, String(index), child.json_key], `${label} ${index + 1}: ${fieldLabel(child)}`);
            if (error) return error;
          }
        }
      }
      return null;
    }
    if (schema.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) return `${label} must be an object.`;
      for (const child of schema.children || []) {
        const error = validate(child, value[child.json_key], [...path, child.json_key]);
        if (error) return error;
      }
      return null;
    }
    if (schema.type === 'duration') {
      if (durationNanoseconds(value) === null) return `${label} must use whole nanoseconds within the supported range.`;
    } else if (numeric(schema.type)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number.`;
      if (schema.type !== 'float64' && !Number.isSafeInteger(value)) return `${label} must be a whole number within the supported range.`;
      const min = schema.type === 'uint64' ? Math.max(0, schema.min ?? 0) : schema.min;
      if (min !== undefined && value < min) return `${label} must be at least ${min}.`;
      if (schema.max !== undefined && value > schema.max) return `${label} must be at most ${schema.max}.`;
    } else if (schema.type === 'bool' && typeof value !== 'boolean') {
      return `${label} must be enabled or disabled.`;
    } else if (schema.type === 'string' && typeof value !== 'string') {
      return `${label} must be text.`;
    }
    if (schema.enum && !schema.enum.includes(value)) return `${label} must use one of the listed choices.`;
    return null;
  }
  for (const field of fields) {
    const error = validate(field, values[field.json_key], [field.json_key]);
    if (error) return error;
  }
  return null;
}

function SchemaField({ schema, value, onChange, disabled, depth, path, secretSet }: {
  schema: FieldSchema;
  value: any;
  onChange: (key: string, value: any) => void;
  disabled: boolean;
  depth: number;
  path: string[];
  secretSet?: Record<string, boolean>;
}) {
  const locked = disabled || !schema.editable;
  const label = fieldLabel(schema);
  const inputId = `field-${path.join('-')}`;
  const storedSecret = secretSet?.[path.join('.')] || secretSet?.[schema.json_key];

  if (unsupportedContainer(schema)) {
    const saved = value ?? schema.default;
    return (
      <div className="input-group">
        <span className="input-label">{label} (read-only)</span>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{saved === undefined ? 'Not set' : JSON.stringify(saved, null, 2)}</pre>
        <span className="text-muted">This structured setting needs a dedicated editor. Its saved value is shown read-only.</span>
      </div>
    );
  }

  if (schema.type === 'object' && schema.children?.length) {
    return (
      <div className={depth > 0 ? 'schema-nested' : ''}>
        {schema.children.map(child => (
          <SchemaField key={child.json_key} schema={child} value={value?.[child.json_key]}
            onChange={(_, childVal) => onChange(schema.json_key, { ...(value || {}), [child.json_key]: childVal })}
            disabled={locked} depth={depth + 1} path={[...path, child.json_key]} secretSet={secretSet} />
        ))}
      </div>
    );
  }

  // Primitive lists must precede the general object-list renderer. Their items
  // are strings, rather than objects containing a field with the child's key.
  if (stringArray(schema)) {
    const items: string[] = Array.isArray(value) ? value : [];
    return (
      <div className="schema-array">
        <div className="input-group"><span className="input-label">{label}{schema.required && <span className="required-mark" aria-hidden="true">*</span>}</span></div>
        {items.map((item, idx) => (
          <div key={idx} className="schema-array-item" style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            <input id={`${inputId}-${idx}`} className="input" style={{ flex: 1, minWidth: 0 }}
              aria-label={`${label} ${idx + 1}`} value={item} disabled={locked}
              onInput={e => {
                const next = [...items];
                next[idx] = (e.target as HTMLInputElement).value;
                onChange(schema.json_key, next);
              }} />
            <button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove ${label} ${idx + 1}`}
              onClick={() => onChange(schema.json_key, items.filter((_, i) => i !== idx))} disabled={locked}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.3rem' }}
          aria-label={`Add ${label}`} onClick={() => onChange(schema.json_key, [...items, ''])} disabled={locked}>+ Add</button>
      </div>
    );
  }

  if (schema.type === 'array' && schema.children?.length) {
    const items: any[] = Array.isArray(value) ? value : [];
    return (
      <div className="schema-array">
        <div className="input-group"><span className="input-label">{label}{schema.required && <span className="required-mark" aria-hidden="true">*</span>}</span></div>
        {items.map((item, idx) => (
          <div key={idx} className="schema-array-item">
            <div className="schema-array-item-header">
              <span className="text-muted" style={{ fontSize: 'var(--font-size-xsmall)' }}>#{idx + 1}</span>
              <button type="button" className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--font-size-xsmall)' }}
                aria-label={`Remove ${label} ${idx + 1}`} onClick={() => onChange(schema.json_key, items.filter((_, i) => i !== idx))} disabled={locked}>Remove</button>
            </div>
            {schema.children!.map(child => (
              <SchemaField key={child.json_key} schema={child} value={item?.[child.json_key]}
                onChange={(_, childVal) => {
                  const next = [...items];
                  next[idx] = { ...(next[idx] || {}), [child.json_key]: childVal };
                  onChange(schema.json_key, next);
                }} disabled={locked} depth={depth + 1} path={[...path, String(idx), child.json_key]} secretSet={secretSet} />
            ))}
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.3rem' }}
          onClick={() => {
            const newItem: Record<string, any> = {};
            schema.children!.forEach(child => { if (child.default !== undefined) newItem[child.json_key] = child.default; });
            onChange(schema.json_key, [...items, newItem]);
          }} disabled={locked}>+ Add {schema.name}</button>
      </div>
    );
  }

  return (
    <div className="input-group">
      <label className="input-label" htmlFor={inputId}>
        {label}{schema.type === 'duration' && ' (seconds)'}{schema.required && <span className="required-mark" aria-hidden="true">*</span>}
        {!schema.editable && <span className="text-muted" style={{ marginLeft: '0.3rem', fontSize: 'var(--font-size-xsmall)' }}>(read-only)</span>}
      </label>
      {schema.secret ? (
        <>
          <input id={inputId} type="password" className="input" autoComplete="new-password" value={value ?? ''}
            placeholder={storedSecret ? 'unchanged — a value is set' : 'not set'} disabled={locked}
            onInput={e => onChange(schema.json_key, (e.target as HTMLInputElement).value)} />
          <span className="text-muted" style={{ fontSize: 'var(--font-size-xsmall)' }}>
            {storedSecret ? 'A value is stored and is never shown here. Type a new one to replace it; leave empty to keep it.'
              : 'Write-only: the value is never shown again after saving.'}
          </span>
        </>
      ) : schema.type === 'duration' ? (
        <>
          <input id={inputId} type="number" className="input" disabled={locked} step="0.000000001"
            value={durationNanoseconds(value ?? schema.default) === null ? value ?? '' : durationNanoseconds(value ?? schema.default)! / 1e9}
            min={schema.min === undefined ? undefined : schema.min / 1e9} max={schema.max === undefined ? undefined : schema.max / 1e9}
            aria-describedby={`${inputId}-units`}
            onInput={e => {
              const raw = (e.target as HTMLInputElement).value;
              const nanos = raw === '' ? null : wholeNanoseconds(Number(raw) * 1e9);
              onChange(schema.json_key, nanos ?? raw);
            }} />
          <span id={`${inputId}-units`} className="text-muted">Enter seconds; the router stores this duration in nanoseconds.</span>
        </>
      ) : schema.enum ? (
        <select id={inputId} className="input" value={value ?? schema.default ?? ''} disabled={locked}
          onChange={e => onChange(schema.json_key, (e.target as HTMLSelectElement).value)} style={{ appearance: 'none', paddingRight: '2rem' }}>
          {schema.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : schema.type === 'bool' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input id={inputId} type="checkbox" checked={value ?? schema.default ?? false} disabled={locked}
            onChange={e => onChange(schema.json_key, (e.target as HTMLInputElement).checked)} style={{ width: '18px', height: '18px' }} />
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-dim)' }}>{(value ?? schema.default) ? 'Enabled' : 'Disabled'}</span>
        </div>
      ) : (
        <input id={inputId} type={numeric(schema.type) ? 'number' : 'text'} className="input" value={value ?? schema.default ?? ''}
          placeholder={schema.default !== undefined ? String(schema.default) : ''} disabled={locked}
          min={schema.type === 'uint64' ? Math.max(0, schema.min ?? 0) : schema.min} max={schema.max} step={schema.type === 'float64' ? 'any' : undefined}
          onInput={e => {
            const raw = (e.target as HTMLInputElement).value;
            // Keep invalid/empty input as a draft. Never truncate 1.5 to 1 or
            // create NaN, which JSON would silently serialize as null.
            const parsed = numeric(schema.type) && raw !== '' ? Number(raw) : raw;
            onChange(schema.json_key, typeof parsed === 'number' && !Number.isFinite(parsed) ? raw : parsed);
          }} />
      )}
    </div>
  );
}

export default function SchemaForm({ fields, values, onChange, disabled, secretSet }: SchemaFormProps) {
  return (
    <div className="flex flex-col gap-sm">
      {fields.map(field => (
        <SchemaField key={field.json_key} schema={field} value={values[field.json_key]} onChange={onChange}
          disabled={disabled || false} depth={0} path={[field.json_key]} secretSet={secretSet} />
      ))}
    </div>
  );
}
