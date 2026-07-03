import { useMemo } from 'react';
import { useInputStore, selectValidationSummary } from '../../state/inputStore';

const STATUS_ICON: Record<string, string> = {
  valid: '✓',
  missing: '○',
  invalid: '✕',
  parsing: '…',
};

function statusColor(status: string): string {
  if (status === 'valid') return 'var(--app-accent)';
  if (status === 'invalid') return 'var(--app-danger)';
  return 'var(--app-muted)';
}

/**
 * The Phase-1 deliverable: a live readiness panel. It lists every required (and every filled
 * optional) input with a valid/missing/invalid marker, surfaces the nested-case-control badge, and
 * shows a single "ready to run" / "needs attention" banner derived from the store selectors.
 */
export function InputSummaryPanel() {
  // Subscribe to the whole (referentially-stable) store state and derive the summary via useMemo.
  // `selectValidationSummary` builds a fresh object each call, so passing it straight to
  // `useInputStore(selector)` would break zustand v5's snapshot-stability contract and loop forever.
  const state = useInputStore();
  const summary = useMemo(() => selectValidationSummary(state), [state]);

  const attention = summary.items.filter(
    (it) => (it.required && it.status !== 'valid') || it.status === 'invalid',
  ).length;

  return (
    <section
      style={{
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
        padding: 12,
        background: 'var(--app-surface-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Input summary</h3>
        {summary.isNcc && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'var(--app-accent)',
              color: 'var(--app-accent-fg)',
            }}
          >
            Nested case-control
          </span>
        )}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {summary.items.map((it) => (
          <li key={it.key} style={{ padding: '3px 0' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ color: statusColor(it.status), fontWeight: 700, width: 14 }}>
                {STATUS_ICON[it.status]}
              </span>
              <span style={{ fontSize: 13 }}>{it.label}</span>
              {!it.required && (
                <span style={{ fontSize: 11, color: 'var(--app-muted)' }}>optional</span>
              )}
            </div>
            {it.errors.map((msg, i) => (
              <div key={`e${i}`} style={{ marginLeft: 22, fontSize: 12, color: 'var(--app-danger)' }}>
                {msg}
              </div>
            ))}
            {it.warnings.map((msg, i) => (
              <div key={`w${i}`} style={{ marginLeft: 22, fontSize: 12, color: 'var(--app-muted)' }}>
                ⚠ {msg}
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1px solid var(--app-border)',
          fontWeight: 600,
          fontSize: 13,
          color: summary.ready ? 'var(--app-accent)' : 'var(--app-muted)',
        }}
      >
        {summary.ready
          ? '✓ Ready to run validation'
          : `${attention} item${attention === 1 ? '' : 's'} need attention`}
      </div>
    </section>
  );
}
