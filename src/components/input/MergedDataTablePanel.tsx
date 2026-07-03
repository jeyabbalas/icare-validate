import { useEffect, useState, type ReactNode } from 'react';
import { readDelimited } from '../../lib/csvIngest';
import { mergeStudyCovariate } from '../../lib/mergeStudyCovariate';
import { fileKey, slotToFile } from '../../lib/slotFiles';
import type { FileSlot } from '../../state/inputStore';
import { DataTablePanel } from '../DataTablePanel';

// The "Cohort / Study" preview when a row-aligned covariate profile is present. Study data and covariate
// profile are the SAME subjects in the SAME order — py-icare links them strictly by row position — so we
// show them as ONE table: re-parse copies of both Files, clean-union their columns by row index
// (mergeStudyCovariate), and hand the resulting in-memory CSV to the shared DataTablePanel. Display-only:
// the raw Files sent to the SDK are never touched. The parent keys this component on both file
// identities, so a changed upload/example remounts it and rebuilds the merged table.

interface Notes {
  idOrderMismatch: boolean;
  foldedColumns: string[];
}

type State =
  | { status: 'merging' }
  | { status: 'error'; message: string }
  | { status: 'ready'; file: File; notes: Notes };

export interface MergedDataTablePanelProps {
  study: FileSlot;
  covariate: FileSlot;
  tableName: string;
  height?: number;
}

export function MergedDataTablePanel({
  study,
  covariate,
  tableName,
  height = 480,
}: MergedDataTablePanelProps) {
  const [state, setState] = useState<State>({ status: 'merging' });
  const studyKey = fileKey(study);
  const covariateKey = fileKey(covariate);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'merging' });

    void (async () => {
      try {
        const [s, c] = await Promise.all([
          slotToFile(study).then(readDelimited),
          slotToFile(covariate).then(readDelimited),
        ]);
        if (cancelled) return;
        const merged = mergeStudyCovariate(s, c);
        const file = new File([merged.csv], 'study_with_covariate_profile.csv', { type: 'text/csv' });
        setState({
          status: 'ready',
          file,
          notes: { idOrderMismatch: merged.idOrderMismatch, foldedColumns: merged.foldedColumns },
        });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Rebuild only when either source file changes (identity via fileKey); study/covariate objects are
    // recreated on unrelated store updates, so we key on their content identity, not reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyKey, covariateKey]);

  if (state.status === 'merging') {
    return <Placeholder height={height}>Preparing merged table…</Placeholder>;
  }
  if (state.status === 'error') {
    return (
      <Placeholder height={height} tone="danger">
        ⚠ Couldn’t merge the study data and covariate profile: {state.message}
      </Placeholder>
    );
  }

  return (
    <div>
      <NotesBanner notes={state.notes} />
      <DataTablePanel
        source={state.file}
        tableName={tableName}
        title="Study data + covariate profile — linked by row order"
        height={height}
      />
    </div>
  );
}

function NotesBanner({ notes }: { notes: Notes }) {
  const { idOrderMismatch, foldedColumns } = notes;
  if (!idOrderMismatch && foldedColumns.length === 0) return null;
  return (
    <div
      style={{
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
        background: 'var(--app-surface-2)',
        padding: '8px 10px',
        marginBottom: 8,
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      {idOrderMismatch && (
        <div style={{ color: 'var(--app-danger)' }}>
          ⚠ Row order differs between the study data and covariate profile (their <code>id</code> values
          don’t line up). iCARE links these files by row position, not by <code>id</code> — ensure both
          list subjects in the same order.
        </div>
      )}
      {foldedColumns.length > 0 && (
        <div style={{ color: 'var(--app-muted)', marginTop: idOrderMismatch ? 6 : 0 }}>
          {foldedColumns.length} covariate-profile column{foldedColumns.length === 1 ? '' : 's'} already
          present in the study data {foldedColumns.length === 1 ? 'is' : 'are'} shown once (
          {foldedColumns.join(', ')}).
        </div>
      )}
    </div>
  );
}

function Placeholder({
  children,
  height,
  tone = 'muted',
}: {
  children: ReactNode;
  height: number;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div
      style={{
        height,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        textAlign: 'center',
        fontSize: 13,
        background: 'var(--app-surface)',
        color: tone === 'danger' ? 'var(--app-danger)' : 'var(--app-muted)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
      }}
    >
      {children}
    </div>
  );
}
