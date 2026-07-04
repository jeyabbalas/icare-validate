// Shared pill/badge. Tones: neutral (muted outline — the ResultsPanel/FileDropSlot idiom), accent (filled
// — the nested-case-control marker), danger (danger outline — engine-error chip). Component-only export.

export type BadgeTone = 'neutral' | 'accent' | 'danger';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const baseStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

function toneStyle(tone: BadgeTone): React.CSSProperties {
  switch (tone) {
    case 'accent':
      return {
        background: 'var(--app-accent)',
        color: 'var(--app-accent-fg)',
        border: '1px solid var(--app-accent)',
      };
    case 'danger':
      return {
        background: 'transparent',
        color: 'var(--app-danger)',
        border: '1px solid var(--app-danger)',
      };
    default:
      return {
        background: 'var(--app-surface-2)',
        color: 'var(--app-muted)',
        border: '1px solid var(--app-border)',
      };
  }
}

export function Badge({ tone = 'neutral', style, ...rest }: BadgeProps) {
  return <span style={{ ...baseStyle, ...toneStyle(tone), ...style }} {...rest} />;
}
