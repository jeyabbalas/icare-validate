// A single metric tile: uppercase label, a large value, and an optional muted sub-line. Lifted verbatim
// from the provisional ResultsPanel (its inner `Metric`) into a shared component so the cohort-summary
// groups — and later results sections — reuse one card. `sub` is a ReactNode (not just a string) so a card
// can stack more than one sub-line (e.g. a range line plus a nested-case-control weighted line). An
// optional `title` sets the native tooltip, used to explain a nuanced tile (e.g. the censoring model).

const card: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface-2)',
  minWidth: 132,
  maxWidth: 300,
  flex: '1 1 132px',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--app-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const subStyle: React.CSSProperties = { fontSize: 11, color: 'var(--app-muted)', marginTop: 2 };

export function Metric({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  title?: string;
}) {
  return (
    <div style={card} title={title}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub != null && sub !== '' && <div style={subStyle}>{sub}</div>}
    </div>
  );
}
