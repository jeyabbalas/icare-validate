import { useId, useRef, useState } from 'react';
import { readNumericVector } from '../../lib/csvIngest';
import { emptyVectorSlot, type NumericVectorSlot } from '../../state/inputStore';

interface NumericVectorUploadProps {
  label: string;
  slot: NumericVectorSlot;
  accept?: string;
  hint?: string;
  onChange: (slot: NumericVectorSlot) => void;
}

/**
 * A file input for the reference-risk arrays. Unlike `FileDropSlot` (which keeps the raw Blob for
 * the SDK), this parses the file into a `number[]` on selection — the SDK types these options as
 * numeric arrays — and reports a `NumericVectorSlot`. Store-agnostic: props in, `onChange` out.
 */
export function NumericVectorUpload({
  label,
  slot,
  accept = '.csv,.json,.txt',
  hint,
  onChange,
}: NumericVectorUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const latestFile = useRef<File | null>(null);

  async function acceptFile(file: File) {
    latestFile.current = file;
    const r = await readNumericVector(file);
    if (latestFile.current !== file) return; // superseded by a newer selection
    onChange({
      values: r.ok ? r.values : null,
      filename: file.name,
      nRows: r.values.length,
      errors: r.errors,
      warnings: r.warnings,
    });
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void acceptFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void acceptFile(file);
  }

  function clear() {
    latestFile.current = null;
    if (inputRef.current) inputRef.current.value = '';
    onChange(emptyVectorSlot());
  }

  const filled = slot.filename !== null;
  const hasError = slot.errors.length > 0;
  const borderColor = dragOver
    ? 'var(--app-accent)'
    : hasError
      ? 'var(--app-danger)'
      : 'var(--app-border)';

  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={inputId} style={{ fontWeight: 600, fontSize: 13, display: 'block' }}>
        {label} <span style={{ fontSize: 11, color: 'var(--app-muted)' }}>optional</span>
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        style={{
          border: `1px ${dragOver ? 'solid' : 'dashed'} ${borderColor}`,
          borderRadius: 'var(--app-radius)',
          padding: '10px 12px',
          marginTop: 4,
          background: dragOver ? 'var(--app-surface-2)' : 'var(--app-surface)',
          cursor: 'pointer',
        }}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onInputChange}
          style={{ display: 'none' }}
        />

        {!filled ? (
          <div style={{ color: 'var(--app-muted)', fontSize: 13 }}>
            Drop a file of numbers here or click to browse ({accept}).
            {hint && <div style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {slot.filename}
              </div>
              <div style={{ fontSize: 11, color: 'var(--app-muted)' }}>
                {slot.nRows === 1 ? '1 value' : `${slot.nRows.toLocaleString()} values`}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              style={{
                border: '1px solid var(--app-border)',
                borderRadius: 'var(--app-radius)',
                background: 'var(--app-surface-2)',
                color: 'var(--app-fg)',
                padding: '2px 8px',
                fontSize: 12,
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {slot.errors.map((msg, i) => (
        <div key={`e${i}`} style={{ color: 'var(--app-danger)', fontSize: 12, marginTop: 4 }}>
          ⚠ {msg}
        </div>
      ))}
      {slot.warnings.map((msg, i) => (
        <div key={`w${i}`} style={{ color: 'var(--app-muted)', fontSize: 12, marginTop: 4 }}>
          {msg}
        </div>
      ))}
    </div>
  );
}
