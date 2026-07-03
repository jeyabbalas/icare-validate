// Live SDK verification in Node (in-process Pyodide, no browser). Boots wasm-icare against the vendored
// public/pyodide assets, runs iCARE-Lit ge50 (cohort happy path) + BPC3 covariate-only (golden anchor),
// and dumps the real frame column keys to confirm them against the pinned list in the Phase-4 plan.
//
// Not part of `npm test` (needs the vendored Pyodide runtime + ~1 min). Run manually:
//   npm run vendor   # once, to populate public/pyodide (git-ignored)
//   node scripts/verify-sdk.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadICARE, PYICARE_WHEEL_FILENAME } from 'wasm-icare';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
// Pyodide's Node loader concatenates indexURL with its asset names, so it wants a plain filesystem path
// (with trailing slash), not a file:// URL. The pyicare wheel is installed via micropip, which fetches a
// file:// URL fine.
const indexURL = P('public', 'pyodide') + path.sep;
const pyicareWheelUrl = pathToFileURL(P('public', 'pyodide', PYICARE_WHEEL_FILENAME)).href;

const iCareLit = (f) => ({ path: P('public', 'examples', 'icare-lit', f) });
const bpc3 = (f) => ({ path: P('public', 'examples', 'bpc3', f) });
const keys = (frame) => (frame?.columns ? Object.keys(frame.columns) : frame?.order);

console.log('[verify] indexURL:', indexURL);

const t0 = Date.now();
const icare = await loadICARE({ offline: true, useWorker: false, indexURL, pyicareWheelUrl });
console.log(`[verify] engine booted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- iCARE-Lit ge50 (cohort) --------------------------------------------------
console.log('\n=== iCARE-Lit ge50 (cohort) ===');
const lit = await icare.validateAbsoluteRiskModel({
  studyData: iCareLit('icare_lit_validation_study.csv'),
  predictedRiskInterval: 'total-followup',
  icareModelParameters: {
    modelDiseaseIncidenceRates: iCareLit('age_specific_breast_cancer_incidence_rates.csv'),
    modelCompetingIncidenceRates: iCareLit('age_specific_all_cause_mortality_rates.csv'),
    modelCovariateFormula: iCareLit('model_formula_ge50.txt'),
    modelLogRelativeRisk: iCareLit('model_log_odds_ratios_ge50.json'),
    modelReferenceDataset: iCareLit('reference_covariate_data_ge50.csv'),
    applyCovariateProfile: iCareLit('icare_lit_validation_covariates.csv'),
  },
  numberOfPercentiles: 10,
  seed: 50,
});
console.log('auc:', lit.auc.auc.toFixed(4), '· eo:', lit.expectedByObservedRatio.ratio.toFixed(4), '· brier:', lit.brierScore.brierScore.toFixed(5));
console.log('studyData nRows:', lit.studyData.nRows, '\n  keys:', keys(lit.studyData));
console.log('categorySpecificCalibration nRows:', lit.categorySpecificCalibration.nRows, '\n  keys:', keys(lit.categorySpecificCalibration));
console.log('incidenceRates keys:', keys(lit.incidenceRates));
console.log('sampling_weights present (expect false):', 'sampling_weights' in lit.studyData.columns);
const lpc = lit.studyData.columns['linear_predictors_category'];
console.log('linear_predictors_category is categorical:', !!(lpc && lpc.codes && lpc.categories), '· sample labels:', lpc?.categories?.slice?.(0, 2));

// ---- BPC3 covariate-only (nested case-control; golden anchor) ------------------
console.log('\n=== BPC3 covariate-only (nested c-c) ===');
const b = await icare.validateAbsoluteRiskModel({
  studyData: bpc3('validation_nested_case_control_data.csv'),
  predictedRiskInterval: 'total-followup',
  icareModelParameters: {
    modelDiseaseIncidenceRates: bpc3('age_specific_breast_cancer_incidence_rates.csv'),
    modelCompetingIncidenceRates: bpc3('age_specific_all_cause_mortality_rates.csv'),
    modelCovariateFormula: bpc3('breast_cancer_covariate_model_formula.txt'),
    modelLogRelativeRisk: bpc3('breast_cancer_model_log_odds_ratios.json'),
    modelReferenceDataset: bpc3('reference_covariate_data.csv'),
    applyCovariateProfile: bpc3('validation_nested_case_control_covariate_data.csv'),
  },
  numberOfPercentiles: 10,
  seed: 50,
});
console.log('auc (golden ~0.6002):', b.auc.auc.toFixed(4));
console.log('eo  (golden ~0.968): ', b.expectedByObservedRatio.ratio.toFixed(4));
console.log('hl  (golden ~7.35/df10):', b.calibration.absoluteRisk.statistic.chiSquare.toFixed(2), 'df', b.calibration.absoluteRisk.parameter.degreesOfFreedom);
console.log('rr  (golden ~6.32/df9): ', b.calibration.relativeRisk.statistic.chiSquare.toFixed(2), 'df', b.calibration.relativeRisk.parameter.degreesOfFreedom);
console.log('sampling_weights present (expect true):', 'sampling_weights' in b.studyData.columns, '· frequency present:', 'frequency' in b.studyData.columns);

await icare.close();
console.log('\n[verify] done.');
