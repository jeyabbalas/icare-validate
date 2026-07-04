# iCARE-validate

Client-side, offline-capable web app for validating **iCARE** (individualized Coherent Absolute
Risk Estimation) absolute-risk models, built on the [`wasm-icare`](https://github.com/jeyabbalas/wasm-icare)
SDK (py-icare running in a Pyodide Web Worker). All computation runs in the browser — no server — and
the app works fully offline after the first load. Deployed to GitHub Pages.

> **Status: Phase 1** — offline runtime + engine service, and the input builder (both modes, file
> ingestion, validation, and one-click examples). Visualizations and the results dashboard arrive in
> later phases.

## Prerequisites

- Node.js ≥ 18 (developed on Node 22; CI uses Node 22)

## Setup

```bash
npm install
npm run vendor   # downloads the pinned Pyodide runtime + wheels into public/pyodide (~36 MB)
```

`npm run vendor` runs `wasm-icare-vendor`, self-hosting Pyodide + the scientific wheels + the pyicare
wheel so the app runs fully offline. **These assets are gitignored — run `vendor` once after cloning**
(CI regenerates them before every build). It reads the Pyodide version from `node_modules`, so it must
run **after** `npm install`.

## Develop

```bash
npm run dev        # http://localhost:5173/icare-validate/
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build at http://localhost:4173/icare-validate/
npm run typecheck
npm run lint
```

In dev, a **"Run iCARE-Lit ge50 smoke test"** button (bottom-right, dev-only) boots the engine and runs
one full validation, logging the `ValidationResult` to the console.

## Offline / PWA

The app self-hosts every WASM asset and registers a service worker (`vite-plugin-pwa`) that precaches
the app shell, the Pyodide runtime, and the example fixtures. After the first load it runs with no
network. Because GitHub Pages cannot send COOP/COEP headers, the app uses single-threaded,
non-cross-origin-isolated WASM (no `SharedArrayBuffer`).

## Deploy (GitHub Pages)

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci` → `npm run vendor` → `npm run build` →
upload → deploy. In the repository, set **Settings → Pages → Source: GitHub Actions**. The Vite `base`
is `/icare-validate/`; the site serves at `https://jeyabbalas.github.io/icare-validate/`. All runtime
asset URLs are built from `import.meta.env.BASE_URL` so they resolve under the project sub-path.

## Example data

One-click examples (loadable in the input builder), copied from `wasm-icare`'s `test/fixtures`:

- **iCARE-Lit (ge50 / lt50)** — cohort, unweighted — `public/examples/icare-lit/`.
- **BPC3** — nested case-control (inverse-probability weighting), 72 SNPs, a
  `C(menopause_hrt):C(bmi)` interaction, and a family-history variable — `public/examples/bpc3/`.

## Reproduce elsewhere (the **Code** tab)

The **Code** tab (the third view, reachable once the inputs are valid) generates copyable,
ready-to-run code that reproduces the current validation in another environment — no need to rerun it
in the app:

- **Python** — `py-icare` natively (`validate_absolute_risk_model`).
- **JavaScript** — `wasm-icare` for Node (`{ path }` inputs) or a self-contained browser page
  (File inputs, engine from the esm.sh CDN).
- **R** — a Quarto notebook: an R chunk serializes each file's raw text to an `{ojs}` cell that
  rebuilds `Blob`s and runs `wasm-icare` in the browser.

The code is generated from your current inputs (files referenced by name — edit the `EDIT`-marked
paths). Hand-written, verified reference versions live in `scripts/reproduce/` (all reproduce the
iCARE-Lit ge50 goldens: AUC 0.6341, E/O 1.0275, HL χ² 23.17); `node scripts/verify-reproduce.mjs`
re-checks them against the vendored engine.

## Troubleshooting

**Console line `[FeatureLifecycle:sentence-player] Re-entrant handleLifecycle call …`** — this is
**not** emitted by this app. None of those identifiers (`sentence-player`, `FeatureLifecycle`,
`handleLifecycle`) exist anywhere in the source or its dependencies; the message comes from a
browser extension's content script (a read-aloud / text-to-speech extension) injected into the page.
To confirm: in DevTools → Sources the emitting `chunk-*.js` resolves to a `chrome-extension://…`
origin (not the dev server), and the line disappears in an Incognito window with extensions
disabled. It is harmless and unrelated to iCARE-validate.

## Tech stack

Vite 8 · React 19 · TypeScript · zustand · vite-plugin-pwa (Workbox) · wasm-icare (Pyodide). Charts
(Observable Plot) and math rendering (KaTeX) arrive in later phases.
