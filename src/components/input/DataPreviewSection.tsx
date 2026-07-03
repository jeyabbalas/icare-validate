import { useMemo, useState } from 'react';
import { slotFilled, useInputStore, type FileSlot } from '../../state/inputStore';
import { DataTablePanel } from '../DataTablePanel';

// Collapsed-by-default preview of the large tabular inputs (so DuckDB never boots on page load).
// Tabbed: the cohort/study file always, plus the reference dataset in Mode A when present. Only
// visited tabs mount; the inactive visited tab is hidden (not unmounted) so switching back is
// instant without re-booting DuckDB. Naturally capped at two live tables.

type TabId = 'study' | 'reference';

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  marginBottom: 16,
};

const tabButton = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
  borderRadius: 'var(--app-radius)',
  background: active ? 'var(--app-accent)' : 'var(--app-surface-2)',
  color: active ? 'var(--app-accent-fg)' : 'var(--app-fg)',
  padding: '6px 12px',
  fontWeight: 600,
  fontSize: 13,
});

// A genuinely different file (new upload / switched example) yields a new key → the panel remounts,
// so its cleanup destroys the old DuckDB worker and a fresh table is built.
function sourceKey(slot: FileSlot): string {
  return slot.file ? `${slot.file.name}:${slot.file.size}:${slot.file.lastModified}` : (slot.url ?? '');
}

export function DataPreviewSection() {
  const study = useInputStore((s) => s.study);
  const mode = useInputStore((s) => s.mode);
  const reference = useInputStore((s) => s.modelFiles.modelReferenceDataset);

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string; slot: FileSlot }[] = [];
    if (slotFilled(study)) list.push({ id: 'study', label: 'Cohort / Study', slot: study });
    if (mode === 'A' && slotFilled(reference)) {
      list.push({ id: 'reference', label: 'Reference', slot: reference });
    }
    return list;
  }, [study, mode, reference]);

  const [active, setActive] = useState<TabId>('study');
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set());

  const activeId = (tabs.find((t) => t.id === active) ?? tabs[0])?.id;

  const markVisited = (id: TabId | undefined) => {
    if (!id) return;
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <div style={cardStyle}>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) markVisited(activeId);
        }}
      >
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          Preview data
          {tabs.length === 0 && (
            <span style={{ color: 'var(--app-muted)', fontWeight: 400 }}>
              {' — load a study '}
              {mode === 'A' ? 'or reference ' : ''}
              file first
            </span>
          )}
        </summary>

        {tabs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div
              role="tablist"
              style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === activeId}
                  onClick={() => {
                    setActive(t.id);
                    markVisited(t.id);
                  }}
                  style={tabButton(t.id === activeId)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tabs
              .filter((t) => visited.has(t.id))
              .map((t) => (
                <div key={t.id} style={{ display: t.id === activeId ? 'block' : 'none' }}>
                  <DataTablePanel
                    key={`${t.id}:${sourceKey(t.slot)}`}
                    tableName={t.id}
                    title={t.slot.filename ?? undefined}
                    source={(t.slot.file ?? t.slot.url) as File | string}
                  />
                </div>
              ))}
          </div>
        )}
      </details>
    </div>
  );
}
