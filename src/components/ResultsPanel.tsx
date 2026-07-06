import { useMemo, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';
import { useRebinStore } from '../state/rebinStore';
import { useRecomputedCalibration } from './results/useRecomputedCalibration';
import { collectResultFiles, downloadText } from '../lib/resultsExport';
import { downloadAllZip } from '../lib/zipExport';
import type { ValidationResult } from '../lib/icareTypes';
import type { NormalizedResult } from '../services/resultNormalizer';
import { CohortSummaryPanel } from './results/CohortSummaryPanel';
import { IncidenceRatesSection } from './results/IncidenceRatesSection';
import { CalibrationPanel } from './results/CalibrationPanel';
import { DiscriminationPanel } from './results/DiscriminationPanel';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

// Phase 6: the Results-step container. Guards the empty state, renders the page header (dataset / model /
// interval + a nested-case-control badge and the "Edit inputs" action), then the grouped cohort
// summary and the visualization sections (Phases 7–11). Phase 13 adds the export actions — a "Download
// all (ZIP)" button and a collapsible list of individual result-file downloads — and lifts the single
// calibration recompute (`rc`) up here so the plots, tables, tiles, and the exported files all share one
// binning. A DEV-only raw inspector still pins the live SDK scalars + frame column keys.

const emptyCard: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 16,
  background: 'var(--app-surface)',
};
const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 16,
};
const downloadsDetails: React.CSSProperties = {
  margin: '0 0 16px',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface)',
  padding: '10px 12px',
};
const fileBtnStyle: React.CSSProperties = { padding: '4px 10px', fontSize: 12 };

export function ResultsPanel() {
  const result = useResultsStore((s) => s.result);
  const normalized = useResultsStore((s) => s.normalized);
  const setStep = useAppStore((s) => s.setStep);

  if (!result || !normalized) {
    return (
      <div style={emptyCard}>
        <p style={{ marginTop: 0, color: 'var(--app-muted)' }}>
          No results yet — run a validation from the Input tab.
        </p>
        <Button variant="secondary" onClick={() => setStep('input')}>
          ← Back to input
        </Button>
      </div>
    );
  }

  return <ResultsContent result={result} normalized={normalized} />;
}

// The non-empty results view. Split out so its calibration + rebin hooks are unconditional (the empty
// state above returns before them).
function ResultsContent({
  result,
  normalized,
}: {
  result: ValidationResult;
  normalized: NormalizedResult;
}) {
  const setStep = useAppStore((s) => s.setStep);

  // The one shared calibration recompute (driven by the results-scoped rebinStore).
  const rc = useRecomputedCalibration(normalized);
  const scale = useRebinStore((s) => s.scale);
  const method = useRebinStore((s) => s.method);
  const numberOfPercentiles = useRebinStore((s) => s.numberOfPercentiles);
  const cutpoints = useRebinStore((s) => s.cutpoints);
  const defaultSpec = useRebinStore((s) => s.defaultSpec);
  const provenance = useResultsStore((s) => s.provenance);
  const rebin = { scale, method, numberOfPercentiles, cutpoints };

  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);

  // Only materialize the individual-file text when the section is expanded (avoids rebuilding the large
  // study-data CSV on every re-bin while it's collapsed). The ZIP path builds its own copy on click.
  const files = useMemo(
    () =>
      filesOpen ? collectResultFiles(result, normalized, rc, rebin, defaultSpec, provenance) : null,
    // `rebin` is rebuilt each render; depend on its fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filesOpen,
      result,
      normalized,
      rc,
      scale,
      method,
      numberOfPercentiles,
      cutpoints,
      defaultSpec,
      provenance,
    ],
  );

  const onDownloadAll = async (): Promise<void> => {
    setBusy(true);
    setExportError(null);
    try {
      await downloadAllZip({ result, normalized, rc, rebin, defaultSpec, provenance });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const { info } = result;
  // One-line reproducibility provenance (frozen at run time). Mode A imputes missing covariates, so its
  // imputation count + seed matter; Mode B validates precomputed risks and does no imputation.
  const provLine =
    provenance == null
      ? null
      : provenance.mode === 'A'
        ? `Mode A · ${provenance.numImputations ?? 5} imputation${
            (provenance.numImputations ?? 5) === 1 ? '' : 's'
          }${provenance.numImputations == null ? ' (default)' : ''} · seed ${provenance.seed}`
        : 'Mode B · precomputed risks';

  return (
    <>
      <div style={headerRow}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{info.datasetName || 'Validation results'}</h2>
          <div style={{ fontSize: 13, color: 'var(--app-muted)' }}>
            {info.modelName || 'Model'} · interval: {info.riskPredictionInterval}
          </div>
          {provLine && (
            <div
              style={{ fontSize: 12, color: 'var(--app-muted)', marginTop: 2 }}
              title={
                provenance?.mode === 'A'
                  ? 'Mode A imputes missing covariates/SNPs (num_imputations, default 5); the seed makes that imputation reproducible.'
                  : 'Mode B validates precomputed risk / linear-predictor columns; no imputation is performed.'
              }
            >
              {provLine}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {normalized.isNcc && <Badge>nested case-control</Badge>}
          <Button
            variant="primary"
            onClick={() => void onDownloadAll()}
            disabled={busy}
            aria-label="Download all results as a ZIP"
          >
            {busy ? 'Preparing ZIP…' : '⬇ Download all (ZIP)'}
          </Button>
          <Button variant="secondary" onClick={() => setStep('input')}>
            Edit inputs
          </Button>
        </div>
      </div>

      {exportError && (
        <p role="alert" style={{ margin: '0 0 12px', color: 'var(--app-danger)', fontSize: 13 }}>
          ⚠ Export failed: {exportError}
        </p>
      )}

      <details
        style={downloadsDetails}
        onToggle={(e) => setFilesOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--app-fg)' }}>
          Download individual files
        </summary>
        {files && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {Object.entries(files).map(([name, text]) => (
              <Button
                key={name}
                variant="secondary"
                style={fileBtnStyle}
                onClick={() => downloadText(text, name)}
              >
                ⬇ {name}
              </Button>
            ))}
          </div>
        )}
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--app-muted)' }}>
          Each chart also downloads on its own from the ⬇ SVG / ⬇ PNG buttons above it.
        </p>
      </details>

      <CohortSummaryPanel normalized={normalized} />

      <IncidenceRatesSection incidence={normalized.incidence} isNcc={normalized.isNcc} />

      <CalibrationPanel result={result} normalized={normalized} rc={rc} />

      <DiscriminationPanel result={result} normalized={normalized} />

      {import.meta.env.DEV && <DevInspector result={result} />}
    </>
  );
}

// DEV-only: the raw SDK scalars + per-frame column keys, kept as a development aid. Tree-shaken out of
// production builds by the `import.meta.env.DEV` guard above.
function DevInspector({ result }: { result: ValidationResult }) {
  const debug = {
    info: result.info,
    auc: result.auc,
    brierScore: result.brierScore,
    expectedByObservedRatio: result.expectedByObservedRatio,
    calibration: result.calibration,
    reference: result.reference
      ? {
          absoluteRisk: result.reference.absoluteRisk.length,
          riskScore: result.reference.riskScore.length,
        }
      : null,
    frames: {
      studyData: { order: result.studyData.order, nRows: result.studyData.nRows },
      categorySpecificCalibration: {
        order: result.categorySpecificCalibration.order,
        nRows: result.categorySpecificCalibration.nRows,
      },
      incidenceRates: { order: result.incidenceRates.order, nRows: result.incidenceRates.nRows },
    },
  };
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--app-muted)' }}>
        Raw result (scalars + frame column keys) · dev
      </summary>
      <pre
        style={{
          fontSize: 11,
          overflowX: 'auto',
          background: 'var(--app-surface-2)',
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--app-radius)',
          padding: 12,
        }}
      >
        {JSON.stringify(debug, null, 2)}
      </pre>
    </details>
  );
}
