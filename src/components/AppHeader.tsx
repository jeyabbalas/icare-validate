import { ThemeToggle } from './ThemeToggle';

export function AppHeader() {
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
      <ThemeToggle />
    </header>
  );
}
