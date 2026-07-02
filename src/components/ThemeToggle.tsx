import { useAppStore } from '../state/appStore';

export function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      style={{
        background: 'transparent',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
        color: 'var(--app-fg)',
        padding: '4px 10px',
      }}
    >
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}
