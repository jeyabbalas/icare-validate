// Live SDK verification in Node (in-process Pyodide, no browser). Boots wasm-icare against the vendored
// public/pyodide assets, runs the shared example validations (iCARE-Lit ge50 cohort + BPC3 covariate-only
// nested case-control golden anchor), and dumps the real frame column keys + scalar metrics to confirm
// them against the pinned list in the Phase-4 plan.
//
// Not part of `npm test` (needs the vendored Pyodide runtime + ~1 min). Run manually:
//   npm run vendor   # once, to populate public/pyodide (git-ignored)
//   node scripts/verify-sdk.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadICARE, PYICARE_WHEEL_FILENAME } from 'wasm-icare';
import { RUNS } from './exampleRuns.mjs';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
// Pyodide's Node loader concatenates indexURL with its asset names, so it wants a plain filesystem path
// (with trailing slash), not a file:// URL. The pyicare wheel is installed via micropip, which fetches a
// file:// URL fine.
const indexURL = P('public', 'pyodide') + path.sep;
const pyicareWheelUrl = pathToFileURL(P('public', 'pyodide', PYICARE_WHEEL_FILENAME)).href;
const keys = (frame) => (frame?.columns ? Object.keys(frame.columns) : frame?.order);

console.log('[verify] indexURL:', indexURL);

const t0 = Date.now();
const icare = await loadICARE({ offline: true, useWorker: false, indexURL, pyicareWheelUrl });
console.log(`[verify] engine booted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

for (const run of RUNS) {
  console.log(`\n=== ${run.label} ===`);
  const r = await icare.validateAbsoluteRiskModel(run.options);
  console.log(
    'auc:',
    r.auc.auc.toFixed(4),
    '· eo:',
    r.expectedByObservedRatio.ratio.toFixed(4),
    '· brier:',
    r.brierScore.brierScore.toFixed(5),
  );
  console.log(
    'hl:',
    r.calibration.absoluteRisk.statistic.chiSquare.toFixed(2),
    'df',
    r.calibration.absoluteRisk.parameter.degreesOfFreedom,
    '· rr:',
    r.calibration.relativeRisk.statistic.chiSquare.toFixed(2),
    'df',
    r.calibration.relativeRisk.parameter.degreesOfFreedom,
  );
  console.log('studyData nRows:', r.studyData.nRows, '\n  keys:', keys(r.studyData));
  console.log(
    'categorySpecificCalibration nRows:',
    r.categorySpecificCalibration.nRows,
    '\n  keys:',
    keys(r.categorySpecificCalibration),
  );
  console.log('incidenceRates keys:', keys(r.incidenceRates));
  console.log(
    'sampling_weights present:',
    'sampling_weights' in r.studyData.columns,
    '· frequency present:',
    'frequency' in r.studyData.columns,
    `(expected ${run.isNcc})`,
  );
}

await icare.close();
console.log('\n[verify] done.');
