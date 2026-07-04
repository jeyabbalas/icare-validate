import { AppHeader } from './components/AppHeader';
import { Stepper } from './components/Stepper';
import { InputBuilder } from './components/input/InputBuilder';
import { ValidateProgress } from './components/ValidateProgress';
import { ResultsPanel } from './components/ResultsPanel';
import { DevExampleRunner } from './components/dev/DevExampleRunner';
import { useAppStore } from './state/appStore';

export default function App() {
  const step = useAppStore((s) => s.step);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
      <AppHeader />
      <Stepper />
      {step === 'input' ? (
        <InputBuilder />
      ) : step === 'validate' ? (
        <ValidateProgress />
      ) : (
        <ResultsPanel />
      )}
      {import.meta.env.DEV && <DevExampleRunner />}
    </div>
  );
}
