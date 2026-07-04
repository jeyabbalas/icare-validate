// Generates the golden KDE fixtures that anchor kde.parity.test.ts to scipy — the faithfulness check for
// Phase 10. Seaborn's `kdeplot` (what py-icare's demo notebook draws) IS `scipy.stats.gaussian_kde` with
// the bandwidth scaled by `bw_adjust`, so reproducing scipy reproduces the notebook. This boots the
// vendored Pyodide (offline; needs `npm run vendor`), reads the two committed calibration fixtures for
// their risk_estimates / observed_outcome / frequency arrays, and for each writes the scipy control/case
// densities on a shared grid to src/math/fixtures/kde-<name>.json.
//
//   npm run vendor       # once, to populate public/pyodide
//   npm run verify:kde
//
// The parity test then evaluates src/math/kde.ts on the SAME stored grid and asserts a pointwise match, so
// the comparison isolates the KDE math (bandwidth + kernel sum) from grid construction.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
const FIX = P('src', 'math', 'fixtures');
const NAMES = ['icare-lit-ge50', 'bpc3-covariate'];

// Reverse loadFixture.ts's sentinels for the few finite columns we read (risk/outcome/frequency are finite).
const decodeVal = (v) =>
  v === '__NaN__' ? NaN : v === '__Inf__' ? Infinity : v === '__NegInf__' ? -Infinity : v;
const column = (frame, key) => {
  const c = frame.columns[key];
  return c ? c.map(decodeVal) : null;
};

// Boot the vendored Pyodide loader (version-aligned with the vendored numpy/scipy wheels), offline.
const { loadPyodide } = await import(pathToFileURL(P('public', 'pyodide', 'pyodide.mjs')).href);
const t0 = Date.now();
const pyodide = await loadPyodide({ indexURL: P('public', 'pyodide') + path.sep });
await pyodide.loadPackage(['numpy', 'scipy']);
console.log(`[kde] pyodide + numpy/scipy booted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const PY = `
import numpy as np, json
from scipy.stats import gaussian_kde

def fit(vals, w):
    a = np.asarray(vals, dtype=float)
    weights = None if w is None else np.asarray(w, dtype=float)
    kde = gaussian_kde(a, weights=weights, bw_method='silverman')
    kde.set_bandwidth(kde.factor * 0.5)            # seaborn bw_adjust=0.5
    return kde, float(np.sqrt(kde.covariance[0, 0]))

# JS null/undefined arrive as None or a JsNull sentinel (no .to_py); both mean "unweighted".
def as_py(x):
    return x.to_py() if hasattr(x, 'to_py') else None
cv = as_py(case_vals);  cw = as_py(case_w)
tv = as_py(ctrl_vals);  tw = as_py(ctrl_w)
kc, bwc = fit(cv, cw)
kt, bwt = fit(tv, tw)
pad = 3.0 * max(bwc, bwt)
lo = min(min(cv), min(tv)) - pad
hi = max(max(cv), max(tv)) + pad
grid = np.linspace(lo, hi, 256)
dc, dt = kc(grid), kt(grid)
trapz = getattr(np, 'trapezoid', None) or np.trapz
json.dumps({
  'grid': grid.tolist(),
  'caseDensity': dc.tolist(),
  'controlDensity': dt.tolist(),
  'caseBw': bwc, 'controlBw': bwt,
  'overlap': float(trapz(np.minimum(dc, dt), grid)),
})
`;

try {
for (const name of NAMES) {
  const raw = JSON.parse(readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
  const sd = raw.studyData;
  const risk = column(sd, 'risk_estimates');
  const outcome = column(sd, 'observed_outcome');
  const freq = column(sd, 'frequency'); // null for a cohort → unweighted KDE
  const isNcc = !!freq;

  const caseVals = [];
  const caseW = [];
  const ctrlVals = [];
  const ctrlW = [];
  for (let i = 0; i < risk.length; i += 1) {
    const r = risk[i];
    if (!Number.isFinite(r)) continue;
    const w = isNcc ? freq[i] : 1;
    if (outcome[i] === 1) {
      caseVals.push(r);
      caseW.push(w);
    } else {
      ctrlVals.push(r);
      ctrlW.push(w);
    }
  }

  pyodide.globals.set('case_vals', caseVals);
  pyodide.globals.set('case_w', isNcc ? caseW : null);
  pyodide.globals.set('ctrl_vals', ctrlVals);
  pyodide.globals.set('ctrl_w', isNcc ? ctrlW : null);
  const out = JSON.parse(pyodide.runPython(PY));

  writeFileSync(path.join(FIX, `kde-${name}.json`), JSON.stringify(out));
  console.log(
    `[kde] wrote kde-${name}.json: ${caseVals.length} cases / ${ctrlVals.length} controls` +
      ` · bw case ${out.caseBw.toExponential(3)} ctrl ${out.controlBw.toExponential(3)} · overlap ${out.overlap.toFixed(4)}`,
  );
}

} catch (err) {
  // PythonError.message carries the python traceback as plain text; avoid dumping Pyodide's minified source.
  console.error('[kde] FAILED:\n' + String(err?.message ?? err).split('\n').slice(-25).join('\n'));
  process.exit(1);
}

console.log('[kde] done.');
