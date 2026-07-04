// Shared card wrapper: the flat border + radius + surface panel used throughout the app (the copy lived
// independently in InputBuilder, DataPreviewSection, ResultsPanel, chartChrome, …). `tone` picks the
// surface layer; `style` merges last for per-call spacing. Component-only export.

export type CardTone = 'surface' | 'surface-2';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
}

const baseStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
};

export function Card({ tone = 'surface', style, ...rest }: CardProps) {
  return (
    <div
      style={{
        ...baseStyle,
        background: tone === 'surface-2' ? 'var(--app-surface-2)' : 'var(--app-surface)',
        ...style,
      }}
      {...rest}
    />
  );
}
