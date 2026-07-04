// Generates the golden ABSOLUTE-RISK re-binning fixtures that anchor calibrationMath.rebin.test.ts — the
// faithfulness check for Phase 12's one path py-icare cannot reach (py-icare bins only on the linear
// predictor). The binning here is done with `pandas.cut(..., include_lowest=True)` — py-icare's OWN binning
// primitive (its `_categorize_risk_scores`) — applied to `risk_estimates`, so it is a genuinely independent
// implementation of the exact include-lowest / right-closed boundary convention the TS `assignBins` must
// match. The per-bin reductions + Hosmer–Lemeshow use py-icare's formulas (binomial variance, or the
// design-corrected weighted variance for a nested case-control study).
//
//   npm run vendor        # once, to populate public/pyodide (numpy/pandas/scipy)
//   npm run verify:rebin
//
// For each committed fixture it writes, per cut spec, the cutoffs + per-bin n/weight/observed/predicted/
// variance/E-O + HL chi²/df to src/math/fixtures/rebin-<name>.json. The parity test then runs
// recomputeCalibration({scale:'absolute-risk', cutoffs}) on the SAME fixture and asserts a match. Cut specs:
// the clinical 3% threshold, and a boundary-exact cut (equal to an actual risk value, so a subject sits ON
// the edge — exercising include-lowest).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
const FIX = P('src', 'math', 'fixtures');
const NAMES = ['icare-lit-ge50', 'bpc3-covariate'];

const decodeVal = (v) =>
  v === '__NaN__' ? NaN : v === '__Inf__' ? Infinity : v === '__NegInf__' ? -Infinity : v;
const column = (frame, key) => {
  const c = frame.columns[key];
  return c ? c.map(decodeVal) : null;
};

const { loadPyodide } = await import(pathToFileURL(P('public', 'pyodide', 'pyodide.mjs')).href);
const t0 = Date.now();
const pyodide = await loadPyodide({ indexURL: P('public', 'pyodide') + path.sep });
await pyodide.loadPackage(['numpy', 'pandas', 'scipy']);
console.log(`[rebin] pyodide + numpy/pandas/scipy booted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const PY = `
import numpy as np, pandas as pd, json
from scipy.stats import chi2 as chi2dist

# JS arrays arrive as JsProxy (.to_py() → list); JS null arrives as a JsNull sentinel (no .to_py) → None.
def as_py(x):
    return x.to_py() if hasattr(x, 'to_py') else None

risk = np.asarray(as_py(risk_vals), float)
outcome = np.asarray(as_py(outcome_vals), float)
sw_list = as_py(sw_vals)                                             # sampling_weights (probabilities) | None
sw = None if sw_list is None else np.asarray(sw_list, float)
freq = None if sw is None else 1.0 / sw                              # frequency = 1/sampling_weights

def calibrate(cutoffs):
    edges = [float(risk.min())] + [float(c) for c in cutoffs] + [float(risk.max())]
    cats = pd.cut(risk, bins=edges, include_lowest=True)             # py-icare's own binning primitive
    d = pd.DataFrame({'risk': risk, 'outcome': outcome, 'cat': cats})
    counts = d.groupby('cat', observed=False).size().to_numpy()
    if freq is None:
        g = d.groupby('cat', observed=False)
        obs = g['outcome'].mean().to_numpy()
        pred = g['risk'].mean().to_numpy()
        weight = counts.astype(float)
        var = obs * (1.0 - obs) / counts
    else:
        d['freq'] = freq
        w = d.groupby('cat', observed=False)['freq'].sum()
        obs_s = (d['outcome'] * d['freq']).groupby(d['cat'], observed=False).sum() / w
        pred_s = (d['risk'] * d['freq']).groupby(d['cat'], observed=False).sum() / w
        pred_map = d['cat'].map(dict(pred_s)).astype(float)         # centre correction on PREDICTED prob
        corr = (d['outcome'] - pred_map) ** 2 * (1.0 - sw) / (sw ** 2)
        corr_per = corr.groupby(d['cat'], observed=False).sum() / w
        var_s = (obs_s * (1.0 - obs_s) + corr_per) / w
        obs, pred, var, weight = obs_s.to_numpy(), pred_s.to_numpy(), var_s.to_numpy(), w.to_numpy()
    k = int(len(obs))
    chi2_ar = float(np.nansum((obs - pred) ** 2 / var))
    with np.errstate(divide='ignore', invalid='ignore'):
        eo = pred / obs
    return dict(nBins=k, edges=edges, n=[int(x) for x in counts], weight=[float(x) for x in weight],
                observed=[float(x) for x in obs], predicted=[float(x) for x in pred],
                variance=[float(x) for x in var], eo=[float(x) for x in eo],
                chiSquare=chi2_ar, df=k, pValue=float(1.0 - chi2dist.cdf(chi2_ar, k)))

out = []
for case in cases:
    c = case.to_py() if hasattr(case, 'to_py') else case
    out.append(dict(id=c['id'], cutoffs=[float(x) for x in c['cutoffs']], **calibrate(c['cutoffs'])))
json.dumps(out)
`;

try {
  for (const name of NAMES) {
    const raw = JSON.parse(readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
    const sd = raw.studyData;
    const riskCol = column(sd, 'risk_estimates');
    const outcomeCol = column(sd, 'observed_outcome');
    const swCol = column(sd, 'sampling_weights'); // null for a cohort → unweighted

    // Keep the finite-risk subjects the engine bins (a non-finite score is excluded, binIndex -1).
    const risk = [];
    const outcome = [];
    const sw = swCol ? [] : null;
    for (let i = 0; i < riskCol.length; i += 1) {
      if (!Number.isFinite(riskCol[i])) continue;
      risk.push(riskCol[i]);
      outcome.push(outcomeCol[i]);
      if (sw) sw.push(swCol[i]);
    }

    // A cut equal to an actual risk value → a subject sits exactly on the edge (include-lowest → lower bin).
    const sorted = [...risk].sort((a, b) => a - b);
    const boundary = sorted[Math.floor(sorted.length / 2)];
    const cases = [
      { id: 'clinical-3pct', cutoffs: [0.03] },
      { id: 'boundary-exact', cutoffs: [boundary] },
    ];

    pyodide.globals.set('risk_vals', risk);
    pyodide.globals.set('outcome_vals', outcome);
    pyodide.globals.set('sw_vals', sw);
    pyodide.globals.set('cases', cases);
    const result = JSON.parse(pyodide.runPython(PY));

    writeFileSync(
      path.join(FIX, `rebin-${name}.json`),
      JSON.stringify({ name, isNcc: !!sw, nSubjects: risk.length, cases: result }),
    );
    for (const c of result) {
      console.log(
        `[rebin] ${name} · ${c.id} cut ${c.cutoffs.map((x) => x.toFixed(4)).join(',')} → ` +
          `${c.nBins} bins n=[${c.n.join(', ')}] · HL χ² ${c.chiSquare.toFixed(3)}/df ${c.df} · ` +
          `E/O=[${c.eo.map((x) => x.toFixed(3)).join(', ')}]`,
      );
    }
  }
} catch (err) {
  console.error('[rebin] FAILED:\n' + String(err?.message ?? err).split('\n').slice(-25).join('\n'));
  process.exit(1);
}

console.log('[rebin] done.');
