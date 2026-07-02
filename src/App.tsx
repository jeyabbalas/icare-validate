import { AppHeader } from './components/AppHeader';
import { Stepper } from './components/Stepper';
import { InputBuilder } from './components/input/InputBuilder';
import { DevExampleRunner } from './components/dev/DevExampleRunner';
import { useAppStore } from './state/appStore';

export default function App() {
  const step = useAppStore((s) => s.step);
  const icareStatus = useAppStore((s) => s.icareStatus);
  const icareError = useAppStore((s) => s.icareError);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 16 }}>
      <AppHeader />
      <Stepper />
      {step === 'input' ? (
        <InputBuilder />
      ) : (
        <main
          style={{
            border: '1px solid var(--app-border)',
            borderRadius: 'var(--app-radius)',
            padding: 16,
            background: 'var(--app-surface)',
          }}
        >
          <p style={{ marginTop: 0, color: 'var(--app-muted)' }}>
            Current step: <strong style={{ color: 'var(--app-fg)' }}>{step}</strong>. Later phases
            fill in the validation run and results dashboard.
          </p>
          <p style={{ marginBottom: 0, color: 'var(--app-muted)' }}>
            Engine status: <strong style={{ color: 'var(--app-fg)' }}>{icareStatus}</strong>
            {icareError ? ` — ${icareError}` : ''}
          </p>
        </main>
      )}
      {import.meta.env.DEV && <DevExampleRunner />}
    </div>
  );
}
