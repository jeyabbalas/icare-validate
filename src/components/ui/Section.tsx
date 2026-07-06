// Shared results-panel chrome: a titled <section> card. Consolidates the card surface + the uppercase
// muted section heading that were re-declared verbatim across CohortSummaryPanel, CalibrationPanel, and
// DiscriminationPanel, and gives each panel one accessible name (aria-label defaults to the title). The
// heading level is explicit so the results view keeps a clean hierarchy — the ResultsPanel header owns the
// <h2> (dataset name), so the grouped panels default to <h3>. Component-only export (the props type is
// erased at build), so it doesn't trip react-refresh.

import type { CSSProperties, ReactNode } from 'react';

const sectionCard: CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  margin: '0 0 16px',
};

const titleStyle: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--app-muted)',
};

interface SectionProps {
  title: string;
  /** Heading level. Panels sit under ResultsPanel's <h2>, so default to <h3>. */
  level?: 2 | 3;
  /** Accessible name for the landmark; defaults to `title`. */
  ariaLabel?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Section({ title, level = 3, ariaLabel, style, children }: SectionProps) {
  const Heading = `h${level}` as 'h2' | 'h3';
  return (
    <section aria-label={ariaLabel ?? title} style={{ ...sectionCard, ...style }}>
      <Heading style={titleStyle}>{title}</Heading>
      {children}
    </section>
  );
}
