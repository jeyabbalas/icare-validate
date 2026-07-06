# iCARE-validate

Client-side, offline-capable web app for validating **iCARE** (individualized Coherent Absolute Risk
Estimation) absolute-risk models, built on the [`wasm-icare`](https://github.com/jeyabbalas/wasm-icare)
SDK (py-icare 1.3.0 running in a Pyodide Web Worker). Upload a model and a validation study — or load a
bundled example — and get an elegant, downloadable report: calibration and discrimination figures plus
the statistics clinicians care about, with instant re-binning by clinically meaningful cutpoints (e.g.
the 3% absolute-risk breast-cancer threshold).

**Everything runs in your browser.** No server, no upload of your data, and — after the first visit — no
network at all.

**▶ Live app: <https://jeyabbalas.github.io/icare-validate/>**

---

## What it does

Researchers who build absolute-risk models need to check two things against a cohort or nested
case-control study: is the model **calibrated** (predicted risk ≈ observed risk) and does it
**discriminate** (separate cases from controls)? iCARE-validate runs the full py-icare validation in the
browser and presents:

- **Cohort summary** — subjects, cases, censoring, follow-up, baseline age (design-weighted "effective
  cohort" too, for nested case-control studies).
- **Calibration** — age-specific incidence (study vs population), absolute-risk and relative-risk
  observed-vs-predicted scatters with confidence intervals, an Expected/Observed-by-group chart, and the
  Hosmer–Lemeshow / relative-risk goodness-of-fit tests.
- **Discrimination** — a case-vs-control risk-density (KDE) plot and an ROC curve, with AUC and the
  Brier score.
- **Interactive re-binning** — re-bin the calibration on the **risk-score (linear-predictor)** or
  **absolute-risk** scale, by equal-count **quantiles** or explicit **cutpoints** (type `3` on the
  absolute-risk scale to split at 3%). The plots, per-bin tables, and goodness-of-fit statistics
  recompute instantly in TypeScript — no re-run of the engine.
- **Export** — every figure as SVG + PNG, every result table as CSV, a `metrics.json`, and a generated
  `README.txt`, bundled into one ZIP.
- **Code tab** — copyable Python / JavaScript / R that reproduces the current validation in your own
  environment.

## Usage

1. **Input.** Load a bundled example in one click, or drop in your own files. Pick the validation mode
   (below). Set the risk-prediction interval, number of bins, dataset/model names, and seed.
2. **Run.** Click **Run validation** in the sticky action bar. The first run boots the Pyodide engine
   (~10–30 s, then cached); later runs are fast.
3. **Results.** Read the cohort summary, then the grouped Calibration and Discrimination sections. Hover
   any chart for per-point detail.
4. **Re-bin** (optional). Use the toolbar above the calibration plots to change the scale/method/cutpoints
   — everything updates without re-running.
5. **Download.** Click **⬇ Download all (ZIP)**, or grab individual figures/files.
6. **Code** (optional). Open the Code tab for a ready-to-run Python/JS/R reproduction of your current
   setup.

Uploaded files are kept as-is and handed straight to the SDK; example files load through the exact same
ingest path.

## The two input modes

**Mode A — build the model from parameters.** Provide the model pieces and iCARE computes each subject's
risk:

- **Study data** (CSV): `observed_outcome`, `study_entry_age`, `study_exit_age`, `time_of_onset`, and
  (nested case-control) `sampling_weights`.
- **Covariate formula** (Patsy `.txt`), **log relative risks** (`.json`, β per design-matrix column),
  **disease incidence rates** (`age,rate` CSV), **reference dataset** (CSV), and a **covariate profile**
  (CSV).
- Optional: **competing incidence rates** (all-cause mortality), **SNP info** + **SNP profile**, a
  **family-history** variable, reference-dataset **weights**, and the **number of imputations**.

The Patsy formula + coefficients render as a readable equation with a per-term coefficient table (β and
exp(β)), instead of raw Patsy.

**Mode B — pre-computed risks.** Your study CSV already contains a predicted-risk column named
`risk_estimates` and a linear-predictor column named `linear_predictors` (py-icare 1.3.0 requires these
exact names). Optionally add a disease-incidence-rates file to get the study-vs-population incidence
comparison.

## Example datasets

Loadable in one click, copied from `wasm-icare`'s `test/fixtures` into `public/examples/`:

- **iCARE-Lit (ge50 / lt50)** — a cohort (unweighted) breast-cancer model. The two variants share the
  study, covariate, disease/competing-rate files and differ in the formula, log-odds-ratios, and
  reference data (`public/examples/icare-lit/`).
- **BPC3** — a nested case-control study (inverse-probability weighting) with 72 SNPs, a
  `C(menopause_hrt):C(bmi)` interaction, and a family-history variable
  (`public/examples/bpc3/`). This exercises the weighted path end-to-end.

## Offline / PWA

The app self-hosts every WebAssembly asset — the Pyodide runtime + scientific wheels + the pyicare wheel,
and the DuckDB-WASM bundle used by the data tables — and a service worker (`vite-plugin-pwa` / Workbox)
precaches the app shell, all of those, the KaTeX fonts, and the example fixtures. After the first load a
**"Ready to work offline ✓"** toast confirms it; from then on the app runs with **no network**, and a
**"new version available — Reload"** toast appears when an update is deployed.

Because GitHub Pages cannot send `COOP`/`COEP` headers, the app uses single-threaded, non–cross-origin-
isolated WebAssembly (no `SharedArrayBuffer`): Pyodide runs single-threaded and DuckDB uses its `eh`
(non-threaded) bundle.

## Develop

Prerequisites: **Node.js 22** (CI uses 22).

```bash
npm install
npm run vendor     # download the pinned Pyodide runtime + wheels and copy the DuckDB bundles into public/
npm run dev        # http://localhost:5173/icare-validate/
```

`npm run vendor` self-hosts Pyodide + the scientific wheels + the pyicare wheel and copies the DuckDB-WASM
bundles into `public/`. **These assets are gitignored — run `vendor` once after cloning** (CI regenerates
them before every build). It reads the pinned Pyodide version from `node_modules`, so run it **after**
`npm install`.

```bash
npm run build      # type-check + production build to dist/
npm run preview     # serve the production build at http://localhost:4173/icare-validate/
npm run typecheck
npm run lint
npm test            # Vitest (hermetic — no Pyodide needed)
```

## Testing & verification

The unit suite (Vitest) is **hermetic**: parity tests read committed golden fixtures
(`src/math/fixtures/`), so `npm test` needs no Pyodide. A separate layer of scripts regenerates those
goldens and checks the app's math against independent oracles running the real vendored engine:

```bash
npm run verify:kde          # KDE parity vs scipy.stats.gaussian_kde
npm run verify:rebin        # absolute-risk re-binning vs pandas.cut + py-icare's own HL formulas
npm run fixtures            # regenerate the committed live ValidationResult fixtures
node scripts/verify-sdk.mjs         # dump + pin the real SDK frame keys / scalars
node scripts/verify-reproduce.mjs   # the Code tab's reference scripts reproduce the goldens
```

Numeric anchors used throughout: BPC3 (covariate-only) `auc ≈ 0.60`, `hl_chisq ≈ 7.35 (df 10)`;
iCARE-Lit ge50 `auc 0.6341`, `E/O 1.0275`, `hl_chisq 23.17`.

## Reproduce elsewhere (the Code tab)

The **Code** tab (the third view, reachable once the inputs are valid) generates copyable, ready-to-run
code that reproduces the current validation in another environment — no need to rerun it in the app:

- **Python** — `py-icare` natively (`validate_absolute_risk_model`).
- **JavaScript** — `wasm-icare` for Node (`{ path }` inputs) or a self-contained browser page (File
  inputs, engine from the esm.sh CDN).
- **R** — a Quarto notebook: an R chunk serializes each file's raw text to an `{ojs}` cell that rebuilds
  `Blob`s and runs `wasm-icare` in the browser.

The code is generated from your current inputs (files referenced by name — edit the `EDIT`-marked paths).
Hand-written, verified reference versions live in `scripts/reproduce/`; `node scripts/verify-reproduce.mjs`
re-checks them against the vendored engine.

## Deploy (GitHub Pages)

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci` → `npm run lint` → `npm test` →
`npm run vendor` → `npm run build` → upload → `deploy-pages`. In the repository, set **Settings → Pages →
Source: GitHub Actions**. The Vite `base` is `/icare-validate/`; the site serves at
<https://jeyabbalas.github.io/icare-validate/>. All runtime asset URLs are built from
`import.meta.env.BASE_URL` so they resolve under the project sub-path, and `dist/404.html` mirrors
`index.html` as a first-load SPA fallback.

## Tech stack

Vite 8 · React 19 · TypeScript · zustand · [Observable Plot](https://observablehq.com/plot/) + d3
utilities (charts) · [KaTeX](https://katex.org/) (model equation) · [`@jeyabbalas/data-table`](https://github.com/jeyabbalas/data-table)
+ DuckDB-WASM (interactive data tables) · [fflate](https://github.com/101arrowz/fflate) (ZIP export) ·
`vite-plugin-pwa` / Workbox (offline) · [`wasm-icare`](https://github.com/jeyabbalas/wasm-icare) (Pyodide
+ py-icare).

## Troubleshooting

**Console line `[FeatureLifecycle:sentence-player] Re-entrant handleLifecycle call …`** — this is **not**
emitted by this app. None of those identifiers (`sentence-player`, `FeatureLifecycle`, `handleLifecycle`)
exist anywhere in the source or its dependencies; the message comes from a browser extension's content
script (a read-aloud / text-to-speech extension) injected into the page. To confirm: in DevTools →
Sources the emitting `chunk-*.js` resolves to a `chrome-extension://…` origin (not the app), and the line
disappears in an Incognito window with extensions disabled. It is harmless and unrelated to iCARE-validate.

## License

MIT © 2026 Jeya Balaji Balasubramanian. See [`LICENSE`](./LICENSE).
