import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

// A class error boundary (the only React API that catches render-time errors). Wraps each view so a crash
// in one shows a recoverable message instead of a blank white page — and, because App keys it by the active
// step, switching tabs clears a crashed view. Reloading re-runs from the cached shell, so it works offline.

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

const wrap: CSSProperties = {
  maxWidth: 640,
  margin: '40px auto',
  padding: 20,
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface)',
};
const pre: CSSProperties = {
  fontSize: 12,
  overflowX: 'auto',
  background: 'var(--app-surface-2)',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  margin: '12px 0',
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for debugging; no telemetry — the app is fully client-side and offline-capable.
    console.error('iCARE-validate crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={wrap}>
        <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
        <p style={{ color: 'var(--app-muted)' }}>
          The app hit an unexpected error. Your data never left your browser. Reloading usually fixes
          it — the app is cached, so it still works offline.
        </p>
        <pre style={pre}>{error.message}</pre>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload the app
        </Button>
      </div>
    );
  }
}
