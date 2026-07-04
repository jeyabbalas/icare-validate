# Reproduce iCARE validation outside the app

Reference scripts that reproduce a `wasm-icare` / `py-icare` model validation in Python, JavaScript
(Node + browser), and R (Quarto). They are the hand-written, **verified** counterpart of the app's
**Code** tab, which generates the same code dynamically from your current inputs. Each script defaults
to the bundled **iCARE-Lit ge50** example so it runs as-is from the repo root; edit the paths (marked
`EDIT`) to point at your own files.

## Verified golden numbers (iCARE-Lit ge50, `number_of_percentiles=10`, `seed=50`)

| Metric | Value |
|---|---|
| AUC | **0.6341** (95% CI 0.5916–0.6765) |
| E/O ratio | **1.0275** |
| Hosmer–Lemeshow χ² | **23.1702** (df 10) |

All four scripts below were run against `public/examples/icare-lit/` and reproduce these to full
precision. (Spot-checked BPC3 nested case-control: AUC 0.5998, E/O 0.9516, HL χ² 7.36.)

## Python — `validate.py` (native py-icare)

```sh
pip install pyicare          # also `pip install packaging` if patsy complains about it
python scripts/reproduce/validate.py
```

Runs the same `pyicare` 1.3.0 package the app runs inside Pyodide, natively on CPython — numbers match.

## JavaScript (Node) — `validate.mjs`

```sh
npm install wasm-icare
node scripts/reproduce/validate.mjs
```

File inputs are filesystem paths (`{ path: '…' }`). The engine loads from `node_modules`; the
scientific wheels download once from the CDN and cache (for offline, vendor a mirror — see the
wasm-icare README).

## JavaScript (browser) — `validate-browser.html`

Serve the folder over http(s) and open the page (e.g. `npx serve scripts/reproduce`), pick the files,
click **Run**. Loads `wasm-icare` from `https://esm.sh/wasm-icare@2` and Pyodide from the jsDelivr CDN
(needs internet the first time). File inputs come from `<input type="file">` (a `File` is a `Blob`).

## R — `validate.qmd` (Quarto + OJS)

```sh
quarto render scripts/reproduce/validate.qmd   # -> validate.html (git-ignored)
```

An R chunk reads the inputs and hands them to an `{ojs}` cell via `ojs_define()`; the OJS cell rebuilds
`Blob`s and calls `wasm-icare` from the CDN in the browser. See the note at the top of the `.qmd` on how
data crosses the R → OJS boundary.

## Why the browser / R routes pass files as `Blob`s (not JS objects)

`wasm-icare` 2.0.0 accepts a model input only as a path / URL / `Blob` (plus an inline formula
*string*). In-memory column tables are **not** accepted for the nested `icareModelParameters` inputs,
and an inline log-OR *object* trips py-icare's float check. So the browser and R routes pass every
tabular input, and the log-OR, as a `Blob` of the raw file text — byte-identical to what the app sends,
and it preserves the `Inf` in `time_of_onset` (censored rows) that a numeric JSON round-trip would lose.

## Re-verify

`node scripts/verify-reproduce.mjs` boots the vendored engine and checks both the `{path}` form (Node /
Python) and the `Blob(raw text)` form (browser / R → OJS) against the golden numbers. (Needs
`public/pyodide/`; run `npm run vendor` first if absent.)
