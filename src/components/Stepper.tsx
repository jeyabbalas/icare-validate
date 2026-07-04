import { useAppStore, type Step } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';

// The app's two top-level views: assemble inputs, then read results. Rendered as prominent underline tabs
// (the primary view switcher) rather than the small toggle buttons they used to be — the active view
// carries a thick accent underline that sits on the full-width divider. Not a wizard (the run happens
// inline on Input), so the labels are plain and unnumbered.
const STEPS: { id: Step; label: string }[] = [
  { id: 'input', label: 'Input' },
  { id: 'results', label: 'Results' },
];

const navStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--app-border)',
  margin: '4px 0 20px',
};
const tabBase: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: 'none',
  borderBottom: '3px solid transparent',
  margin: '0 0 -1px', // overlap the nav's 1px border so the active underline reads as sitting on the divider
  padding: '10px 14px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--app-muted)',
};

export function Stepper() {
  const step = useAppStore((s) => s.step);
  const setStep = useAppStore((s) => s.setStep);
  // Results is reachable only once a validation has produced one. During a run we stay on Input (the
  // RunActionBar shows progress and auto-advances on success), so the in-flight state no longer unlocks it.
  const hasResult = useResultsStore((s) => s.result !== null);

  return (
    <nav aria-label="Views" style={navStyle}>
      {STEPS.map((s) => {
        const active = step === s.id;
        const disabled = s.id === 'results' && !hasResult;
        return (
          <button
            key={s.id}
            type="button"
            className="view-tab"
            onClick={disabled ? undefined : () => setStep(s.id)}
            disabled={disabled}
            aria-current={active ? 'page' : undefined}
            aria-disabled={disabled || undefined}
            style={{
              ...tabBase,
              ...(active
                ? { color: 'var(--app-accent)', borderBottomColor: 'var(--app-accent)' }
                : null),
              ...(disabled ? { cursor: 'not-allowed', opacity: 0.5 } : null),
            }}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
