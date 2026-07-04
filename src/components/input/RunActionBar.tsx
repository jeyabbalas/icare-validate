import { useMemo } from 'react';
import { runValidation } from '../../services/validationRunner';
import { selectValidationSummary, useInputStore } from '../../state/inputStore';
import { useResultsStore } from '../../state/resultsStore';
import { useAppStore } from '../../state/appStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

// The primary call to action, promoted out of the narrow input sidebar into a full-width bar pinned to the
// bottom of the Input tab so it's reachable from any scroll position. It absorbs what used to be a separate
// "Validate" progress screen: the same bar morphs ready → running/booting → error in place (reading the run
// lifecycle from `resultsStore.status` and the engine boot from `appStore.icareStatus`), and auto-advances
// to Results on success (handled in `runValidation`). No navigation happens here.

const barStyle: React.CSSProperties = {
  position: 'sticky',
  bottom: 16,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 16,
  marginTop: 16,
  padding: '12px 16px',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface)',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.12)',
};

export function RunActionBar() {
  // Subscribe to the whole (referentially-stable) input store and derive the summary via useMemo —
  // `selectValidationSummary` builds a fresh object each call, so passing it straight to a zustand selector
  // would break v5's snapshot-stability contract and loop forever (the InputSummaryPanel pattern).
  const state = useInputStore();
  const summary = useMemo(() => selectValidationSummary(state), [state]);
  const attention = summary.items.filter(
    (it) => (it.required && it.status !== 'valid') || it.status === 'invalid',
  ).length;
  const ready = summary.ready;
  const datasetName = state.datasetName.trim();

  const status = useResultsStore((s) => s.status);
  const error = useResultsStore((s) => s.error);
  const icareStatus = useAppStore((s) => s.icareStatus);

  const running = status === 'running';
  const disabled = !ready || running;

  return (
    <div style={barStyle}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        {running ? (
          <RunningStatus
            booting={icareStatus === 'loading'}
            datasetName={datasetName}
            isNcc={summary.isNcc}
          />
        ) : status === 'error' ? (
          <div role="alert" style={{ minWidth: 0, color: 'var(--app-danger)' }}>
            <div style={{ fontWeight: 600 }}>⚠ Validation failed</div>
            {error && <div style={{ fontSize: 12 }}>{error}</div>}
          </div>
        ) : (
          <div
            style={{ fontWeight: 600, color: ready ? 'var(--app-accent)' : 'var(--app-muted)' }}
          >
            {ready
              ? '✓ Ready to run validation'
              : `${attention} item${attention === 1 ? '' : 's'} need attention`}
          </div>
        )}
      </div>

      <Button
        variant="primary"
        onClick={() => void runValidation()}
        disabled={disabled}
        style={{ whiteSpace: 'nowrap' }}
      >
        {running ? 'Running…' : status === 'error' ? 'Retry validation →' : 'Run validation →'}
      </Button>
    </div>
  );
}

// The running state re-homes the copy from the old Validate progress screen: booting vs. computing, plus
// the dataset name and nested-case-control marker for context.
function RunningStatus({
  booting,
  datasetName,
  isNcc,
}: {
  booting: boolean;
  datasetName: string;
  isNcc: boolean;
}) {
  const heading = booting ? 'Booting the iCARE engine…' : 'Running validation…';
  const detail = booting
    ? 'Initializing Pyodide and py-icare — the first run can take 10–30 seconds.'
    : 'Computing calibration and discrimination on your study data.';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <Spinner label={heading} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{heading}</span>
          {datasetName && (
            <span
              style={{
                color: 'var(--app-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}
            >
              {datasetName}
            </span>
          )}
          {isNcc && <Badge tone="accent">nested case-control</Badge>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--app-muted)' }}>{detail}</div>
      </div>
    </div>
  );
}
