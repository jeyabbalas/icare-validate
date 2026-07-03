import { useAppStore, type Step } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';

const STEPS: { id: Step; label: string }[] = [
  { id: 'input', label: '1 · Input' },
  { id: 'validate', label: '2 · Validate' },
  { id: 'results', label: '3 · Results' },
];

export function Stepper() {
  const step = useAppStore((s) => s.step);
  const setStep = useAppStore((s) => s.setStep);
  // Results is reachable only once a validation has produced one (or while one is in flight).
  const hasResult = useResultsStore((s) => s.result !== null || s.status === 'running');

  return (
    <nav aria-label="Progress" style={{ display: 'flex', gap: 8, padding: '8px 0 16px' }}>
      {STEPS.map((s) => {
        const active = step === s.id;
        const disabled = s.id === 'results' && !hasResult;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            disabled={disabled}
            aria-current={active ? 'step' : undefined}
            style={{
              background: active ? 'var(--app-accent)' : 'var(--app-surface)',
              color: active ? 'var(--app-accent-fg)' : 'var(--app-muted)',
              border: '1px solid var(--app-border)',
              borderRadius: 'var(--app-radius)',
              padding: '6px 12px',
              fontWeight: active ? 600 : 400,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
