// Reproduce an iCARE absolute-risk model validation in Node.js with wasm-icare.
//
//   npm install wasm-icare
//   node validate.mjs
//
// The engine (Pyodide + pyicare) loads from your local node_modules; the scientific wheels download
// once and cache under .pyodide-cache. For a fully offline run, vendor a Pyodide mirror
// (`npx wasm-icare-vendor ./pyodide`) and pass indexURL/pyicareWheelUrl/offline to loadICARE()
// (see the wasm-icare README, "Self-hosting / offline").
import { loadICARE } from 'wasm-icare';

// EDIT these paths to point at your own files. They default to this repo's bundled iCARE-Lit ge50
// example, so the script runs as-is from the repo root.
const dir = 'public/examples/icare-lit';

const icare = await loadICARE();
const v = await icare.validateAbsoluteRiskModel({
  // In Node, file inputs are filesystem paths: { path: '…' }. (In the browser, pass a File/Blob or
  // { url: '…' } instead — see validate.html.)
  studyData: { path: `${dir}/icare_lit_validation_study.csv` },
  predictedRiskInterval: 'total-followup',
  icareModelParameters: {
    modelDiseaseIncidenceRates: { path: `${dir}/age_specific_breast_cancer_incidence_rates.csv` },
    modelCompetingIncidenceRates: { path: `${dir}/age_specific_all_cause_mortality_rates.csv` },
    modelCovariateFormula: { path: `${dir}/model_formula_ge50.txt` },
    modelLogRelativeRisk: { path: `${dir}/model_log_odds_ratios_ge50.json` },
    modelReferenceDataset: { path: `${dir}/reference_covariate_data_ge50.csv` },
    applyCovariateProfile: { path: `${dir}/icare_lit_validation_covariates.csv` },
  },
  numberOfPercentiles: 10,
  seed: 50,
  datasetName: 'iCARE-Lit ge50',
  modelName: 'iCARE-Lit',
});
await icare.close(); // release the runtime

const cal = v.calibration.absoluteRisk;
console.log(`AUC = ${v.auc.auc.toFixed(4)}  [${v.auc.lowerCi.toFixed(4)}, ${v.auc.upperCi.toFixed(4)}]`);
console.log(`E/O ratio = ${v.expectedByObservedRatio.ratio.toFixed(4)}`);
console.log(`Hosmer-Lemeshow chi-square = ${cal.statistic.chiSquare.toFixed(4)} (df ${cal.parameter.degreesOfFreedom})`);
// Expected for the bundled iCARE-Lit ge50 example: AUC ≈ 0.6341, E/O ≈ 1.0275, HL χ² ≈ 23.17 (df 10).
