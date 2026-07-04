import { useEffect, useId, useState } from 'react';
import type { AgeSpecValue, RiskIntervalConfig } from '../../state/inputStore';

const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--app-muted)', marginTop: 2 };

/** Parse a free-text field of comma/space/newline-separated tokens into finite numbers. */
function parseNumberList(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

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

/**
 * A free-text input for a list of numbers that keeps the raw text as local draft state. The previous
 * approach made the input `value` the parsed-then-rejoined numbers, which erased any not-yet-valid
 * keystroke — a lone "-", a trailing "." or "," — so negatives, decimals, and multi-value lists were
 * impossible to type ("-" parsed to nothing and the field cleared). Here the typed text is the source of
 * truth for display; we only re-sync it from `canonical` (the text form of the store value) when an
 * EXTERNAL change (Reset, Load example) makes the typed numbers diverge from the store — never mid-typing.
 * The parent still receives the parsed numbers via `onNumbers` on every change.
 */
function NumericTextInput({
  id,
  placeholder,
  canonical,
  onNumbers,
  style,
}: {
  id?: string;
  placeholder?: string;
  canonical: string;
  onNumbers: (nums: number[]) => void;
  style?: React.CSSProperties;
}) {
  const [text, setText] = useState(canonical);

  // Re-sync only when the store value (canonical) represents a DIFFERENT set of numbers than what's typed.
  // Comparing the numeric forms (not raw strings) preserves in-progress input like "-", "1.", or "1, 2,".
  useEffect(() => {
    if (parseNumberList(text).join(', ') !== canonical) setText(canonical);
  }, [canonical, text]);

  return (
    <input
      id={id}
      type="text"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onNumbers(parseNumberList(e.target.value));
      }}
      style={style ?? inputStyle}
    />
  );
}

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
          min={1}
          step={1}
          value={Number.isFinite(value.years) ? value.years : ''}
          onChange={(e) => onChange({ kind: 'years', years: Math.round(Number(e.target.value)) })}
          style={{ ...inputStyle, width: 140, marginTop: 6 }}
        />
      )}
      {value.kind === 'custom' && (
        <NumericTextInput
          placeholder="e.g. 5, 5, 10 — whole years, one per subject"
          canonical={value.values.length ? value.values.join(', ') : ''}
          onNumbers={(nums) => onChange({ kind: 'custom', values: nums })}
          style={{ ...inputStyle, marginTop: 6 }}
        />
      )}
    </div>
  );
}

/** A free-text field that parses to `number[] | null` (e.g. linear-predictor cutoffs). */
export function NumericListField({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  values: number[] | null;
  onChange: (v: number[] | null) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <NumericTextInput
        id={id}
        placeholder={placeholder}
        canonical={values && values.length ? values.join(', ') : ''}
        onNumbers={(nums) => onChange(nums.length ? nums : null)}
      />
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

/** Edits an SDK `AgeSpec`: one token → a single number, several → an array, empty → `null`. */
export function AgeSpecField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: AgeSpecValue;
  onChange: (v: AgeSpecValue) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  const canonical = value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <NumericTextInput
        id={id}
        placeholder={placeholder}
        canonical={canonical}
        onNumbers={(nums) =>
          onChange(nums.length === 0 ? null : nums.length === 1 ? nums[0] : nums)
        }
      />
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}
