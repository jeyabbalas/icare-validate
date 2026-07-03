import { useAppStore } from '../state/appStore';
import { useInputStore } from '../state/inputStore';
import { useResultsStore } from '../state/resultsStore';

const card: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 24,
  background: 'var(--app-surface)',
  textAlign: 'center',
};

const linkButton: React.CSSProperties = {
  marginTop: 16,
  padding: '8px 12px',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface-2)',
  color: 'var(--app-fg)',
};

/**
 * The Validate step. The SDK exposes no boot/compute progress, so this is an indeterminate spinner keyed
 * on the run lifecycle (`resultsStore.status`) and the engine boot signal (`appStore.icareStatus`). It
 * also handles the states reachable by navigating here directly (idle / done) and surfaces run errors.
 */
export function ValidateProgress() {
  const icareStatus = useAppStore((s) => s.icareStatus);
  const setStep = useAppStore((s) => s.setStep);
  const status = useResultsStore((s) => s.status);
  const error = useResultsStore((s) => s.error);
  const datasetName = useInputStore((s) => s.datasetName.trim());
  const isNcc = useInputStore((s) => Boolean(s.study.parse?.badges?.includes('ncc')));

  if (status === 'error') {
    return (
      <main style={card}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--app-danger)' }}>
          Validation failed
        </h2>
        <p style={{ margin: '0 auto', maxWidth: 560, color: 'var(--app-fg)' }}>{error}</p>
        <button type="button" style={linkButton} onClick={() => setStep('input')}>
          ← Back to input
        </button>
      </main>
    );
  }

  if (status === 'idle') {
    return (
      <main style={card}>
        <p style={{ margin: 0, color: 'var(--app-muted)' }}>
          No validation is running yet — assemble your inputs and click{' '}
          <strong style={{ color: 'var(--app-fg)' }}>Run validation</strong>.
        </p>
        <button type="button" style={linkButton} onClick={() => setStep('input')}>
          ← Back to input
        </button>
      </main>
    );
  }

  if (status === 'done') {
    return (
      <main style={card}>
        <p style={{ margin: 0, color: 'var(--app-muted)' }}>
          Validation complete.{' '}
          <button
            type="button"
            onClick={() => setStep('results')}
            style={{ background: 'none', border: 'none', color: 'var(--app-accent)', padding: 0 }}
          >
            View results →
          </button>
        </p>
      </main>
    );
  }

  // status === 'running'
  const booting = icareStatus === 'loading';
  const heading = booting ? 'Booting the iCARE engine…' : 'Running validation…';
  const detail = booting
    ? 'Initializing Pyodide and py-icare — the first run can take 10–30 seconds.'
    : 'Computing calibration and discrimination on your study data.';

  return (
    <main style={card}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <div className="icv-spinner" role="status" aria-label={heading} />
      </div>
      <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{heading}</h2>
      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
        {datasetName || 'Your dataset'}
        {isNcc ? ' · nested case-control' : ''}
      </p>
      <p style={{ margin: 0, color: 'var(--app-muted)' }}>{detail}</p>
    </main>
  );
}
