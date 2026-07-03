import { useMemo, useState } from 'react';
import { fileKey } from '../../lib/slotFiles';
import { slotFilled, useInputStore, type FileSlot } from '../../state/inputStore';
import { DataTablePanel } from '../DataTablePanel';
import { MergedDataTablePanel } from './MergedDataTablePanel';

// Collapsed-by-default preview of the large tabular inputs (so DuckDB never boots on page load).
// Tabbed: the cohort/study file always (merged with the covariate profile when they are row-aligned —
// the same subjects in the same order, per py-icare), plus the reference dataset in Mode A when present,
// and a standalone covariate-profile tab only when it can't be merged (row counts differ). Only visited
// tabs mount; the inactive visited tab is hidden (not unmounted) so switching back is instant without
// re-booting DuckDB. The study tab may build an in-memory merged CSV; the raw Files sent to the SDK are
// untouched.

type TabId = 'study' | 'covariate' | 'reference';

interface Tab {
  id: TabId;
  label: string;
  slot: FileSlot;
  /** When set (study tab only), render a merged study+covariate table instead of a single-file one. */
  merge?: FileSlot;
}

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

export function DataPreviewSection() {
  const study = useInputStore((s) => s.study);
  const mode = useInputStore((s) => s.mode);
  const reference = useInputStore((s) => s.modelFiles.modelReferenceDataset);
  const covariate = useInputStore((s) => s.modelFiles.applyCovariateProfile);

  // Study data and covariate profile are linked by row position (py-icare requires one profile row per
  // study subject); merge them into one table only when both are present and their row counts match.
  const studyRows = study.parse?.nRows;
  const covariateRows = covariate.parse?.nRows;
  const canMerge =
    mode === 'A' &&
    slotFilled(study) &&
    slotFilled(covariate) &&
    studyRows != null &&
    covariateRows != null &&
    covariateRows === studyRows;
  const rowCountMismatch =
    mode === 'A' &&
    slotFilled(study) &&
    slotFilled(covariate) &&
    studyRows != null &&
    covariateRows != null &&
    covariateRows !== studyRows;

  const tabs = useMemo(() => {
    const list: Tab[] = [];
    if (slotFilled(study)) {
      list.push({
        id: 'study',
        label: 'Cohort / Study',
        slot: study,
        merge: canMerge ? covariate : undefined,
      });
    }
    // Standalone covariate tab only when it can't be folded into the study tab (unmerged).
    if (mode === 'A' && slotFilled(covariate) && !canMerge) {
      list.push({ id: 'covariate', label: 'Covariate profile', slot: covariate });
    }
    if (mode === 'A' && slotFilled(reference)) {
      list.push({ id: 'reference', label: 'Reference', slot: reference });
    }
    return list;
  }, [study, mode, reference, covariate, canMerge]);

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

            {rowCountMismatch && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--app-muted)' }}>
                ⚠ The study data has {studyRows} row(s) but the covariate profile has {covariateRows}.
                iCARE pairs them one row per subject, so they’re shown as separate tables here rather than
                merged.
              </div>
            )}

            {tabs
              .filter((t) => visited.has(t.id))
              .map((t) => (
                <div key={t.id} style={{ display: t.id === activeId ? 'block' : 'none' }}>
                  {t.merge ? (
                    <MergedDataTablePanel
                      key={`merged:${fileKey(t.slot)}+${fileKey(t.merge)}`}
                      study={t.slot}
                      covariate={t.merge}
                      tableName={t.id}
                    />
                  ) : (
                    <DataTablePanel
                      key={`${t.id}:${fileKey(t.slot)}`}
                      tableName={t.id}
                      title={t.slot.filename ?? undefined}
                      source={(t.slot.file ?? t.slot.url) as File | string}
                    />
                  )}
                </div>
              ))}
          </div>
        )}
      </details>
    </div>
  );
}
