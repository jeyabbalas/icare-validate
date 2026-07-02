import { useState } from 'react';
import { validate } from '../../services/icareService';

// Built from BASE_URL literally so it resolves under the GitHub Pages sub-path.
const BASE = import.meta.env.BASE_URL;

/**
 * Dev-only end-to-end proof: runs the iCARE-Lit (ge50) validation fully offline and logs the
 * `ValidationResult`. Its second job is to PIN the (intentionally loose) result shape — the exact
 * column keys of `categorySpecificCalibration` / `studyData` are a documented downstream unknown
 * that Phases 4/5 depend on. Rendered only when `import.meta.env.DEV` (gated in App), so it
 * tree-shakes out of production builds.
 */
export function DevExampleRunner() {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setNote('Booting Pyodide + running iCARE-Lit (ge50)… first run takes ~10–30 s.');
    const dir = `${BASE}examples/icare-lit/`;
    try {
      console.time('[iCARE-Lit] validate');
      const result = await validate({
        studyData: { url: `${dir}icare_lit_validation_study.csv` },
        predictedRiskInterval: 'total-followup',
        icareModelParameters: {
          modelDiseaseIncidenceRates: {
            url: `${dir}age_specific_breast_cancer_incidence_rates.csv`,
          },
          modelCompetingIncidenceRates: {
            url: `${dir}age_specific_all_cause_mortality_rates.csv`,
          },
          modelCovariateFormula: { url: `${dir}model_formula_ge50.txt` },
          modelLogRelativeRisk: { url: `${dir}model_log_odds_ratios_ge50.json` },
          modelReferenceDataset: { url: `${dir}reference_covariate_data_ge50.csv` },
          applyCovariateProfile: { url: `${dir}icare_lit_validation_covariates.csv` },
        },
        numberOfPercentiles: 10,
        seed: 50,
      });
      console.timeEnd('[iCARE-Lit] validate');

      // (1) Map the shape first — the ValidationResult tree is intentionally loose in the SDK.
      console.log('[iCARE-Lit] top-level keys:', Object.keys(result));
      console.log('[iCARE-Lit] full result:', result);
      // (2) Named metrics.
      console.log('[iCARE-Lit] auc:', result.auc);
      console.log('[iCARE-Lit] brierScore:', result.brierScore);
      console.log('[iCARE-Lit] expectedByObservedRatio:', result.expectedByObservedRatio);
      console.log('[iCARE-Lit] calibration:', result.calibration);
      // (3) Pin the per-bin / per-subject column keys for later phases.
      console.log(
        '[iCARE-Lit] categorySpecificCalibration.order:',
        result.categorySpecificCalibration?.order,
      );
      console.log('[iCARE-Lit] studyData.order:', result.studyData?.order);

      const auc = result.auc?.auc;
      setNote(
        `Done. AUC ≈ ${typeof auc === 'number' ? auc.toFixed(4) : '?'} — see console for the full result.`,
      );
    } catch (e) {
      console.error('[iCARE-Lit] FAILED:', e);
      setNote(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        maxWidth: 320,
        textAlign: 'right',
      }}
    >
      {note && (
        <div
          style={{
            marginBottom: 8,
            padding: '6px 10px',
            fontSize: 12,
            background: 'var(--app-surface-2)',
            border: '1px solid var(--app-border)',
            borderRadius: 'var(--app-radius)',
            color: 'var(--app-fg)',
          }}
        >
          {note}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={running}
        style={{
          padding: '8px 12px',
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--app-radius)',
          background: 'var(--app-accent)',
          color: 'var(--app-accent-fg)',
          fontWeight: 600,
        }}
      >
        {running ? 'Running…' : 'Run iCARE-Lit ge50 smoke test'}
      </button>
    </div>
  );
}
