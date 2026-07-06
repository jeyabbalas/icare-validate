import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui/Button';

// Surfaces the service-worker lifecycle so the app's headline offline capability + updates aren't
// invisible (vite.config uses registerType: 'prompt'): a one-time "ready to work offline" confirmation
// once precaching completes, and a "new version available -> Reload" prompt when an updated build is
// waiting. A dismissible fixed toast, bottom-right, themed with the app tokens.

const toast: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 50,
  maxWidth: 340,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface)',
  color: 'var(--app-fg)',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.18)',
  fontSize: 13,
};
const btn: React.CSSProperties = { padding: '4px 10px', fontSize: 13 };

export function PwaReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <div role="status" aria-live="polite" style={toast}>
      <span style={{ flex: 1 }}>
        {needRefresh ? 'A new version is available.' : 'Ready to work offline ✓'}
      </span>
      {needRefresh && (
        <Button variant="primary" style={btn} onClick={() => void updateServiceWorker(true)}>
          Reload
        </Button>
      )}
      <Button variant="secondary" style={btn} onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}
