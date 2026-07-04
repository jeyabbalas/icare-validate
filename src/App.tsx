import { useEffect } from 'react';
import { AppHeader } from './components/AppHeader';
import { Stepper } from './components/Stepper';
import { InputBuilder } from './components/input/InputBuilder';
import { ResultsPanel } from './components/ResultsPanel';
import { ensureLoaded } from './services/icareService';
import { useAppStore } from './state/appStore';

export default function App() {
  const step = useAppStore((s) => s.step);

  // Pre-warm the iCARE engine (Pyodide + py-icare) in the background while the user assembles inputs, so the
  // first validation isn't stalled by the 10–30s boot. `ensureLoaded` memoizes its promise, so this is
  // idempotent and safe under StrictMode's double-invoke; a boot failure resets the memo and surfaces on the
  // actual run (and via the header engine chip → `icareStatus`).
  useEffect(() => {
    void ensureLoaded().catch(() => {
      /* swallow here — the failure is reflected in icareStatus and re-attempted when the user runs */
    });
  }, []);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
      <AppHeader />
      <Stepper />
      {step === 'input' ? <InputBuilder /> : <ResultsPanel />}
    </div>
  );
}
