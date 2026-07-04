import { useAppStore, type Step } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';
import { Button } from './ui/Button';

// Two views: assemble inputs, then read results. Not a wizard anymore (the run happens inline on Input),
// so the labels are plain and unnumbered.
const STEPS: { id: Step; label: string }[] = [
  { id: 'input', label: 'Input' },
  { id: 'results', label: 'Results' },
];

export function Stepper() {
  const step = useAppStore((s) => s.step);
  const setStep = useAppStore((s) => s.setStep);
  // Results is reachable only once a validation has produced one. During a run we stay on Input (the
  // RunActionBar shows progress and auto-advances on success), so the in-flight state no longer unlocks it.
  const hasResult = useResultsStore((s) => s.result !== null);

  return (
    <nav aria-label="Views" style={{ display: 'flex', gap: 8, padding: '8px 0 16px' }}>
      {STEPS.map((s) => {
        const active = step === s.id;
        const disabled = s.id === 'results' && !hasResult;
        return (
          <Button
            key={s.id}
            variant="toggle"
            active={active}
            onClick={() => setStep(s.id)}
            disabled={disabled}
            aria-current={active ? 'page' : undefined}
            style={{ padding: '6px 12px', fontSize: 13 }}
          >
            {s.label}
          </Button>
        );
      })}
    </nav>
  );
}
