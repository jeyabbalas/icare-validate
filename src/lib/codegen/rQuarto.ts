import { renderJsOptions } from './jsOptions';
import type { CodegenModel, FileParam } from './model';

// R + Quarto renderer. An R chunk reads each input file's raw text and hands it to OJS via ojs_define();
// an {ojs} cell rebuilds Blobs and calls wasm-icare from the CDN. Raw text is byte-faithful — it
// preserves the `Inf` in time_of_onset (censored rows), and Blob is the only in-memory form the SDK
// accepts for the model tables and the log-OR (an inline formula string is the one exception). Built
// with a line array (not a template literal) to keep the many backticks/`${}` in the output literal.
// See scripts/reproduce/validate.qmd for the verified reference.

const varName = (jsKey: string) => `${jsKey}Text`;

/** An R double-quoted string literal. */
function rString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function renderRQuarto(model: CodegenModel): string {
  const fileParams = [...model.top, ...model.model].filter(
    (p): p is FileParam => p.type === 'file',
  );

  const defines = fileParams
    .map((p) => `  ${varName(p.jsKey)} = read_file(${rString(p.filename)})`)
    .join(',\n');

  // In OJS: a formula input passes as an inline string; every other file input as a Blob of its text.
  const optionBody = renderJsOptions(model, '    ', (p) =>
    p.kind === 'formula' ? { expr: varName(p.jsKey) } : { expr: `new Blob([${varName(p.jsKey)}])` },
  );

  const L: string[] = [];
  L.push('---');
  L.push('title: "iCARE model validation (R + Quarto)"');
  L.push('format:');
  L.push('  html:');
  L.push('    embed-resources: true');
  L.push('engine: knitr');
  L.push('---');
  L.push('');
  L.push(
    "An R chunk reads the inputs and serializes each file's raw text to OJS via `ojs_define()`; the",
  );
  L.push(
    '`{ojs}` cell rebuilds `Blob`s and runs `wasm-icare` in your browser. Raw text is byte-faithful',
  );
  L.push(
    '(it preserves the `Inf` in `time_of_onset`) and is the form the SDK accepts for the model tables',
  );
  L.push('and the log-OR JSON. EDIT the file paths in the R chunk to point at your files.');
  for (const w of model.warnings) {
    L.push('');
    L.push(`> **Note:** ${w}`);
  }
  L.push('');
  L.push('## Load and serialize the inputs (R)');
  L.push('');
  L.push('```{r}');
  L.push('#| label: load-inputs');
  L.push('library(readr)');
  L.push('');
  L.push('# EDIT these paths to point at the files in your workspace.');
  L.push('ojs_define(');
  L.push(defines);
  L.push(')');
  L.push('```');
  L.push('');
  L.push('## Run the validation (OJS, in your browser)');
  L.push('');
  L.push(
    'Loading the engine pulls Pyodide + pyicare from the jsDelivr CDN the first time (~40 MB,',
  );
  L.push(
    '~20-30 s; needs internet). For a fully offline notebook, self-host a Pyodide mirror and pass',
  );
  L.push('`indexURL`/`pyicareWheelUrl` to `loadICARE` (see the wasm-icare README).');
  L.push('');
  L.push('```{ojs}');
  L.push('//| label: load-engine');
  L.push('icare = (await import("https://esm.sh/wasm-icare@2")).loadICARE()');
  L.push('```');
  L.push('');
  L.push('```{ojs}');
  L.push('//| label: validate');
  L.push('result = {');
  L.push('  const i = await icare;');
  L.push('  return i.validateAbsoluteRiskModel({');
  L.push(...optionBody);
  L.push('  });');
  L.push('}');
  L.push('```');
  L.push('');
  L.push('## Results (OJS)');
  L.push('');
  L.push('```{ojs}');
  L.push('//| label: metrics');
  L.push('md`');
  L.push('| Metric | Value |');
  L.push('|---|---|');
  L.push(
    '| **AUC** | ${result.auc.auc.toFixed(4)} [${result.auc.lowerCi.toFixed(4)}, ${result.auc.upperCi.toFixed(4)}] |',
  );
  L.push('| **E/O ratio** | ${result.expectedByObservedRatio.ratio.toFixed(4)} |');
  L.push(
    '| **Hosmer-Lemeshow χ²** | ${result.calibration.absoluteRisk.statistic.chiSquare.toFixed(4)} (df ${result.calibration.absoluteRisk.parameter.degreesOfFreedom}) |',
  );
  L.push('`');
  L.push('```');
  return L.join('\n') + '\n';
}
