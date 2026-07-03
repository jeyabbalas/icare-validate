import { useMemo } from 'react';
import { useAppStore } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';
import type { GoodnessOfFitTest } from '../lib/icareTypes';

// Phase 4's provisional results view: a compact metric strip that proves the full pipeline (build →
// validate → normalize → store) end-to-end. Phase 6 replaces it with the grouped cohort-summary panel,
// and Phases 7–11 add the visualizations. A collapsible raw inspector also pins the live frame keys.

const panel: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 16,
  background: 'var(--app-surface)',
};

function fmt(x: number | undefined, digits = 3): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(digits) : '—';
}
function pval(p: number | undefined): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '—';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}
function gof(g: GoodnessOfFitTest): string {
  return `χ² ${fmt(g.statistic?.chiSquare, 2)} · df ${g.parameter?.degreesOfFreedom ?? '—'} · p ${pval(g.pValue)}`;
}
function countCases(outcome: Float64Array): number {
  let c = 0;
  for (let i = 0; i < outcome.length; i += 1) c += outcome[i];
  return c;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
        padding: 12,
        background: 'var(--app-surface-2)',
        minWidth: 132,
        flex: '1 1 132px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--app-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--app-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function ResultsPanel() {
  const result = useResultsStore((s) => s.result);
  const normalized = useResultsStore((s) => s.normalized);
  const setStep = useAppStore((s) => s.setStep);

  const nCases = useMemo(
    () => (normalized ? countCases(normalized.perSubject.observedOutcome) : 0),
    [normalized],
  );

  if (!result || !normalized) {
    return (
      <main style={panel}>
        <p style={{ marginTop: 0, color: 'var(--app-muted)' }}>
          No results yet — run a validation from the Input step.
        </p>
        <button
          type="button"
          onClick={() => setStep('input')}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--app-border)',
            borderRadius: 'var(--app-radius)',
            background: 'var(--app-surface-2)',
            color: 'var(--app-fg)',
          }}
        >
          ← Back to input
        </button>
      </main>
    );
  }

  const { info, auc, brierScore, expectedByObservedRatio, calibration } = result;
  const ps = normalized.perSubject;

  const debug = {
    info,
    auc,
    brierScore,
    expectedByObservedRatio,
    calibration,
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
    <main style={panel}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{info.datasetName || 'Validation results'}</h2>
          <div style={{ fontSize: 13, color: 'var(--app-muted)' }}>
            {info.modelName || 'Model'} · interval: {info.riskPredictionInterval}
            {normalized.isNcc ? ' · nested case-control' : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStep('input')}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--app-border)',
            borderRadius: 'var(--app-radius)',
            background: 'var(--app-surface-2)',
            color: 'var(--app-fg)',
          }}
        >
          New validation
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Metric label="Subjects" value={String(ps.n)} />
        <Metric label="Cases" value={String(nCases)} />
        <Metric label="Bins" value={String(normalized.categoryCalibration.nBins)} />
        <Metric
          label="AUC"
          value={fmt(auc.auc)}
          sub={`95% CI ${fmt(auc.lowerCi)}–${fmt(auc.upperCi)}`}
        />
        <Metric
          label="E / O ratio"
          value={fmt(expectedByObservedRatio.ratio)}
          sub={`95% CI ${fmt(expectedByObservedRatio.lowerCi)}–${fmt(expectedByObservedRatio.upperCi)}`}
        />
        <Metric
          label="Brier score"
          value={fmt(brierScore.brierScore, 4)}
          sub={`95% CI ${fmt(brierScore.lowerCi, 4)}–${fmt(brierScore.upperCi, 4)}`}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          marginTop: 12,
          fontSize: 12,
          color: 'var(--app-muted)',
        }}
      >
        <div>
          <strong style={{ color: 'var(--app-fg)' }}>Hosmer–Lemeshow (absolute risk):</strong>{' '}
          {gof(calibration.absoluteRisk)}
        </div>
        <div>
          <strong style={{ color: 'var(--app-fg)' }}>Relative-risk GOF:</strong>{' '}
          {gof(calibration.relativeRisk)}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--app-muted)', marginBottom: 4 }}>
        This is a provisional summary — the full cohort panel and visualizations arrive in later phases.
      </p>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--app-muted)' }}>
          Raw result (scalars + frame column keys)
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
    </main>
  );
}
