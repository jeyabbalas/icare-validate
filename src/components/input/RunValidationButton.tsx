import { runValidation } from '../../services/validationRunner';
import { selectIsReadyToRun, useInputStore } from '../../state/inputStore';
import { useResultsStore } from '../../state/resultsStore';

/**
 * The primary call to action, rendered in the input summary footer. Enabled once the input set is
 * ready; kicks off {@link runValidation}, which advances the stepper to the Validate progress view.
 */
export function RunValidationButton() {
  const ready = useInputStore(selectIsReadyToRun);
  const running = useResultsStore((s) => s.status === 'running');
  const disabled = !ready || running;

  return (
    <button
      type="button"
      onClick={() => void runValidation()}
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        marginTop: 10,
        width: '100%',
        padding: '10px 12px',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
        background: disabled ? 'var(--app-surface)' : 'var(--app-accent)',
        color: disabled ? 'var(--app-muted)' : 'var(--app-accent-fg)',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {running ? 'Running…' : 'Run validation →'}
    </button>
  );
}
