import { useId, useRef, useState } from 'react';
import { ingestByKind, type SlotKind } from '../../lib/csvIngest';
import { emptySlot, type FileSlot } from '../../state/inputStore';
import { Button } from '../ui/Button';

interface FileDropSlotProps {
  label: string;
  slot: FileSlot;
  kind: SlotKind;
  /** Accepted file extensions, e.g. ".csv" or ".json". */
  accept?: string;
  optional?: boolean;
  hint?: string;
  onChange: (slot: FileSlot) => void;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A single drag-and-drop / click-to-browse file slot. It owns no store state — it renders the
 * `slot` prop and reports changes via `onChange`, so it is reusable for every input type and easy
 * to test. On selection it runs the validator for `kind` and attaches the resulting `parse` meta.
 */
export function FileDropSlot({
  label,
  slot,
  kind,
  accept,
  optional,
  hint,
  onChange,
}: FileDropSlotProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Guards against a stale validation (fast successive selections) overwriting a newer one.
  const latestFile = useRef<File | null>(null);

  async function accept_(file: File) {
    latestFile.current = file;
    const base: FileSlot = {
      file,
      url: null,
      source: 'upload',
      filename: file.name,
      size: file.size,
      parsing: true,
    };
    onChange(base);
    const parse = await ingestByKind(kind, file);
    if (latestFile.current !== file) return; // a newer file superseded this one
    onChange({ ...base, parsing: false, parse });
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void accept_(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void accept_(file);
  }

  function clear() {
    latestFile.current = null;
    if (inputRef.current) inputRef.current.value = '';
    onChange(emptySlot());
  }

  const filled = slot.file !== null || slot.url !== null;
  const errors = slot.parse?.errors ?? [];
  const warnings = slot.parse?.warnings ?? [];
  const hasError = errors.length > 0;
  const isNcc = slot.parse?.badges?.includes('ncc');

  const borderColor = dragOver
    ? 'var(--app-accent)'
    : hasError
      ? 'var(--app-danger)'
      : 'var(--app-border)';

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <label htmlFor={inputId} style={{ fontWeight: 600, fontSize: 13 }}>
          {label}
        </label>
        {optional ? (
          <span style={{ fontSize: 11, color: 'var(--app-muted)' }}>optional</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--app-danger)' }}>required</span>
        )}
        {isNcc && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'var(--app-accent)',
              color: 'var(--app-accent-fg)',
            }}
          >
            NCC
          </span>
        )}
      </div>

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
            Drop a file here or click to browse{accept ? ` (${accept})` : ''}.
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
                {slot.source === 'example' && (
                  <span style={{ color: 'var(--app-muted)', fontWeight: 400 }}> · example</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--app-muted)' }}>
                {slot.parsing
                  ? 'Validating…'
                  : slot.parse
                    ? summarize(slot.parse.headers.length, slot.parse.nRows, slot.parse.preview)
                    : ''}
                {slot.size != null ? ` · ${humanSize(slot.size)}` : ''}
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              style={{ padding: '2px 8px', fontSize: 12 }}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {errors.map((msg, i) => (
        <div key={`e${i}`} style={{ color: 'var(--app-danger)', fontSize: 12, marginTop: 4 }}>
          ⚠ {msg}
        </div>
      ))}
      {warnings.map((msg, i) => (
        <div key={`w${i}`} style={{ color: 'var(--app-muted)', fontSize: 12, marginTop: 4 }}>
          {msg}
        </div>
      ))}
    </div>
  );
}

function summarize(nCols: number, nRows: number, preview?: string): string {
  if (preview && nCols === 0) return preview; // formula / log-OR
  const cols = nCols === 1 ? '1 column' : `${nCols} columns`;
  const rows = nRows === 1 ? '1 row' : `${nRows.toLocaleString()} rows`;
  return `${rows} × ${cols}`;
}
