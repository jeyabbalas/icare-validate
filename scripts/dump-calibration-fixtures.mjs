// Generates the golden calibration fixtures the hermetic parity tests run against. Boots wasm-icare in
// Node (in-process Pyodide, needs `npm run vendor`), runs the two shared example validations, and writes
// a pruned, serialized ValidationResult per study to src/math/fixtures/.
//
//   npm run vendor      # once, to populate public/pyodide (git-ignored)
//   npm run fixtures
//
// Serialization notes (both are load-bearing):
//   • studyData is pruned to only the ~13 columns normalizeValidationResult reads, so BPC3's 91-column
//     frame stays small (~0.7 MB) while still exercising the real normalizer → engine path.
//   • NaN / ±Infinity are meaningful (censored time_of_onset, degenerate-bin E/O, empty-bin stats) but
//     JSON.stringify turns them into null — they are encoded as sentinel strings and revived by
//     loadFixture.ts. Finite doubles are written at full precision (no rounding), so they round-trip
//     bit-for-bit.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadICARE, PYICARE_WHEEL_FILENAME } from 'wasm-icare';
import { RUNS } from './exampleRuns.mjs';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
const OUT_DIR = P('src', 'math', 'fixtures');

// Columns normalizeValidationResult reads out of studyData (drop the rest — e.g. BPC3's 72 SNP columns).
const STUDY_COLUMNS = [
  'id',
  'observed_outcome',
  'study_entry_age',
  'study_exit_age',
  'time_of_onset',
  'observed_followup',
  'predicted_risk_interval',
  'followup',
  'risk_estimates',
  'linear_predictors',
  'linear_predictors_category',
  'sampling_weights',
  'frequency',
];

function encNum(x) {
  if (typeof x !== 'number') return x;
  if (Number.isNaN(x)) return '__NaN__';
  if (x === Infinity) return '__Inf__';
  if (x === -Infinity) return '__NegInf__';
  return x;
}

// Recursively convert typed arrays → plain arrays, CategoricalColumn → a tagged object, and NaN/±Inf →
// sentinel strings, so the whole structure is JSON-safe and round-trips exactly.
function encode(v) {
  if (typeof v === 'number') return encNum(v);
  if (v === null || v === undefined) return null;
  if (ArrayBuffer.isView(v)) return Array.from(v, encNum);
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    if ('codes' in v && 'categories' in v) {
      return { __cat__: true, codes: Array.from(v.codes), categories: v.categories };
    }
    const out = {};
    for (const k of Object.keys(v)) out[k] = encode(v[k]);
    return out;
  }
  return v;
}

function pruneFrame(frame, keep) {
  const columns = {};
  const order = [];
  for (const k of frame.order) {
    if (keep && !keep.includes(k)) continue;
    columns[k] = frame.columns[k];
    order.push(k);
  }
  return { columns, order, nRows: frame.nRows };
}

const indexURL = P('public', 'pyodide') + path.sep;
const pyicareWheelUrl = pathToFileURL(P('public', 'pyodide', PYICARE_WHEEL_FILENAME)).href;

const t0 = Date.now();
const icare = await loadICARE({ offline: true, useWorker: false, indexURL, pyicareWheelUrl });
console.log(`[fixtures] engine booted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

mkdirSync(OUT_DIR, { recursive: true });

for (const run of RUNS) {
  const result = await icare.validateAbsoluteRiskModel(run.options);
  const raw = {
    id: run.id,
    label: run.label,
    isNcc: run.isNcc,
    numberOfPercentiles: run.numberOfPercentiles,
    seed: run.options.seed,
    info: result.info,
    auc: result.auc,
    brierScore: result.brierScore,
    expectedByObservedRatio: result.expectedByObservedRatio,
    calibration: result.calibration,
    method: result.method,
    studyData: pruneFrame(result.studyData, STUDY_COLUMNS),
    categorySpecificCalibration: pruneFrame(result.categorySpecificCalibration, null),
    incidenceRates: pruneFrame(result.incidenceRates, null),
  };
  const file = path.join(OUT_DIR, `${run.id}.json`);
  writeFileSync(file, JSON.stringify(encode(raw)));
  const hl = result.calibration.absoluteRisk;
  console.log(
    `[fixtures] wrote ${run.id}: ${result.studyData.nRows} subjects, ${result.categorySpecificCalibration.nRows} bins` +
      ` · HL ${hl.statistic.chiSquare.toFixed(3)}/df${hl.parameter.degreesOfFreedom} · auc ${result.auc.auc.toFixed(4)}`,
  );
}

await icare.close();
console.log('[fixtures] done.');
