import { useId } from 'react';
import type { RiskIntervalConfig } from '../../state/inputStore';

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-bg)',
  color: 'var(--app-fg)',
  padding: '6px 8px',
  fontSize: 13,
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  display: 'block',
  marginBottom: 4,
};

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--app-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  hint?: string;
}) {
  const id = useId();
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={inputStyle}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--app-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** Editor for the `predictedRiskInterval` discriminated union. */
export function RiskIntervalControl({
  value,
  onChange,
}: {
  value: RiskIntervalConfig;
  onChange: (v: RiskIntervalConfig) => void;
}) {
  const radio = (kind: RiskIntervalConfig['kind'], text: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <input
        type="radio"
        name="risk-interval"
        checked={value.kind === kind}
        onChange={() => {
          if (kind === 'total-followup') onChange({ kind: 'total-followup' });
          else if (kind === 'years') onChange({ kind: 'years', years: 5 });
          else onChange({ kind: 'custom', values: [] });
        }}
      />
      {text}
    </label>
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <span style={labelStyle}>Predicted-risk interval</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {radio('total-followup', 'Total follow-up (each subject’s observed follow-up time)')}
        {radio('years', 'Fixed number of years')}
        {radio('custom', 'Custom per-subject intervals')}
      </div>

      {value.kind === 'years' && (
        <input
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(value.years) ? value.years : ''}
          onChange={(e) => onChange({ kind: 'years', years: Number(e.target.value) })}
          style={{ ...inputStyle, width: 140, marginTop: 6 }}
        />
      )}
      {value.kind === 'custom' && (
        <input
          type="text"
          placeholder="e.g. 5, 5, 10 (one per subject)"
          value={value.values.join(', ')}
          onChange={(e) =>
            onChange({
              kind: 'custom',
              values: e.target.value
                .split(/[,\s]+/)
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n)),
            })
          }
          style={{ ...inputStyle, marginTop: 6 }}
        />
      )}
    </div>
  );
}
