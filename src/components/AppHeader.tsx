import { useAppStore } from '../state/appStore';
import { Badge, type BadgeTone } from './ui/Badge';
import { ThemeToggle } from './ThemeToggle';

// The iCARE engine (Pyodide + py-icare) is pre-warmed on mount (see App.tsx), so this chip lets the user
// watch the boot progress from any tab and know when a run will be instant. Tone tracks the lifecycle.
const ENGINE_LABEL: Record<string, string> = {
  idle: 'Engine idle',
  loading: 'Engine loading…',
  ready: 'Engine ready',
  error: 'Engine error',
};
const ENGINE_TONE: Record<string, BadgeTone> = {
  idle: 'neutral',
  loading: 'neutral',
  ready: 'accent',
  error: 'danger',
};

export function AppHeader() {
  const icareStatus = useAppStore((s) => s.icareStatus);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 12,
        borderBottom: '1px solid var(--app-border)',
        marginBottom: 12,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>iCARE-validate</h1>
        <p style={{ margin: '2px 0 0', color: 'var(--app-muted)', fontSize: 12 }}>
          Client-side validation of iCARE absolute-risk models
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Badge
          tone={ENGINE_TONE[icareStatus]}
          title="iCARE compute engine (Pyodide + py-icare)"
          aria-live="polite"
        >
          {ENGINE_LABEL[icareStatus]}
        </Badge>
        <ThemeToggle />
      </div>
    </header>
  );
}
