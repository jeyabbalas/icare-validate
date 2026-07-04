// Verification harness for the "Code" tab's reproduction snippets. Proves the two data-passing paths
// the generated code relies on both reproduce the iCARE-Lit ge50 golden numbers:
//   (1) filesystem {path} inputs — the Node / Python snippets.
//   (2) Blob(raw file text) inputs — the browser (File) and R -> OJS routes. This mirrors the app's
//       exact byte path (raw bytes -> pandas.read_csv). It is the ONLY in-memory form wasm-icare 2.0.0
//       accepts for the nested icareModelParameters tables: {columns} is rejected there, and an inline
//       log-OR *object* trips py-icare's float check — so the log-OR must also be a Blob of its JSON.
//       (An inline formula *string* is fine.) Raw text also preserves the `Inf` in `time_of_onset`
//       (censored rows) losslessly, avoiding any JSON non-finite ambiguity.
//
// Not part of `npm test` (needs the vendored Pyodide runtime + ~10s). Run manually:
//   node scripts/verify-reproduce.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadICARE, PYICARE_WHEEL_FILENAME } from 'wasm-icare';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
const EX = (f) => P('public', 'examples', 'icare-lit', f);
const text = (f) => readFileSync(EX(f), 'utf8');
const blob = (f) => new Blob([text(f)]); // Node 22 has a global Blob (a valid TabularInput)

// Golden targets (src/math/fixtures/icare-lit-ge50.json), nPct=10, seed=50.
const GOLD = { auc: 0.6341, eo: 1.0275, hl: 23.17 };

function assertClose(label, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? 'OK ' : 'XX '} ${label}: ${got.toFixed(4)} (want ~${want}, tol ${tol})`);
  if (!ok) process.exitCode = 1;
  return ok;
}
function report(label, r) {
  console.log(`\n=== ${label} ===`);
  assertClose('auc', r.auc.auc, GOLD.auc, 0.005);
  assertClose('eo ', r.expectedByObservedRatio.ratio, GOLD.eo, 0.005);
  assertClose('hl ', r.calibration.absoluteRisk.statistic.chiSquare, GOLD.hl, 0.05);
}

// ---- Boot the engine offline against the vendored runtime -----------------------------------------
const icare = await loadICARE({
  offline: true,
  useWorker: false,
  indexURL: P('public', 'pyodide') + path.sep,
  pyicareWheelUrl: pathToFileURL(P('public', 'pyodide', PYICARE_WHEEL_FILENAME)).href,
});
console.log('[verify-reproduce] engine booted');

// (1) Filesystem {path} form — the Node / Python snippets.
const pathResult = await icare.validateAbsoluteRiskModel({
  studyData: { path: EX('icare_lit_validation_study.csv') },
  predictedRiskInterval: 'total-followup',
  icareModelParameters: {
    modelDiseaseIncidenceRates: { path: EX('age_specific_breast_cancer_incidence_rates.csv') },
    modelCompetingIncidenceRates: { path: EX('age_specific_all_cause_mortality_rates.csv') },
    modelCovariateFormula: { path: EX('model_formula_ge50.txt') },
    modelLogRelativeRisk: { path: EX('model_log_odds_ratios_ge50.json') },
    modelReferenceDataset: { path: EX('reference_covariate_data_ge50.csv') },
    applyCovariateProfile: { path: EX('icare_lit_validation_covariates.csv') },
  },
  numberOfPercentiles: 10,
  seed: 50,
});
report('(1) filesystem {path} inputs', pathResult);

// (2) Blob(raw text) inputs — the browser (File) and R -> OJS routes. Verify `Inf` survives in the
// raw study text (censored rows) before the run.
console.log(
  '\n[verify-reproduce] study text preserves the "Inf" token?',
  /(^|,)Inf(,|\r?$)/m.test(text('icare_lit_validation_study.csv')),
);
const blobResult = await icare.validateAbsoluteRiskModel({
  studyData: blob('icare_lit_validation_study.csv'),
  predictedRiskInterval: 'total-followup',
  icareModelParameters: {
    modelDiseaseIncidenceRates: blob('age_specific_breast_cancer_incidence_rates.csv'),
    modelCompetingIncidenceRates: blob('age_specific_all_cause_mortality_rates.csv'),
    modelCovariateFormula: text('model_formula_ge50.txt'), // inline formula string (accepted)
    modelLogRelativeRisk: blob('model_log_odds_ratios_ge50.json'), // Blob of JSON (inline object is NOT accepted)
    modelReferenceDataset: blob('reference_covariate_data_ge50.csv'),
    applyCovariateProfile: blob('icare_lit_validation_covariates.csv'),
  },
  numberOfPercentiles: 10,
  seed: 50,
});
report('(2) Blob(raw text) inputs — browser / R->OJS', blobResult);

await icare.close();
console.log(`\n[verify-reproduce] done${process.exitCode ? ' — FAILURES above' : ' — all OK'}`);
