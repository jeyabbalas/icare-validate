import { useAppStore } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';
import type { ValidationResult } from '../lib/icareTypes';
import { CohortSummaryPanel } from './results/CohortSummaryPanel';
import { IncidenceRatesSection } from './results/IncidenceRatesSection';
import { AbsoluteRiskCalibrationSection } from './results/AbsoluteRiskCalibrationSection';

// Phase 6: the Results-step container. Guards the empty state, renders the page header (dataset / model /
// interval + a nested-case-control badge and the "New validation" action), then the grouped cohort
// summary. Phases 7–11 add visualization sections as siblings below the summary. A DEV-only raw inspector
// still pins the live SDK scalars + frame column keys for development; it is stripped from production.

const emptyCard: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 16,
  background: 'var(--app-surface)',
};
const btn: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface-2)',
  color: 'var(--app-fg)',
  cursor: 'pointer',
};
const badge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid var(--app-border)',
  background: 'var(--app-surface-2)',
  color: 'var(--app-muted)',
  whiteSpace: 'nowrap',
};

export function ResultsPanel() {
  const result = useResultsStore((s) => s.result);
  const normalized = useResultsStore((s) => s.normalized);
  const setStep = useAppStore((s) => s.setStep);

  if (!result || !normalized) {
    return (
      <main style={emptyCard}>
        <p style={{ marginTop: 0, color: 'var(--app-muted)' }}>
          No results yet — run a validation from the Input step.
        </p>
        <button type="button" onClick={() => setStep('input')} style={btn}>
          ← Back to input
        </button>
      </main>
    );
  }

  const { info } = result;

  return (
    <main>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{info.datasetName || 'Validation results'}</h2>
          <div style={{ fontSize: 13, color: 'var(--app-muted)' }}>
            {info.modelName || 'Model'} · interval: {info.riskPredictionInterval}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {normalized.isNcc && <span style={badge}>nested case-control</span>}
          <button type="button" onClick={() => setStep('input')} style={btn}>
            New validation
          </button>
        </div>
      </div>

      <CohortSummaryPanel result={result} normalized={normalized} />

      <IncidenceRatesSection incidence={normalized.incidence} isNcc={normalized.isNcc} />

      <AbsoluteRiskCalibrationSection result={result} normalized={normalized} />

      {import.meta.env.DEV && <DevInspector result={result} />}
    </main>
  );
}

// DEV-only: the raw SDK scalars + per-frame column keys, kept as a development aid while Phases 7–11 bind
// to the frames. Tree-shaken out of production builds by the `import.meta.env.DEV` guard above.
function DevInspector({ result }: { result: ValidationResult }) {
  const debug = {
    info: result.info,
    auc: result.auc,
    brierScore: result.brierScore,
    expectedByObservedRatio: result.expectedByObservedRatio,
    calibration: result.calibration,
    reference: result.reference
      ? { absoluteRisk: result.reference.absoluteRisk.length, riskScore: result.reference.riskScore.length }
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
