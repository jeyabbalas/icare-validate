import { renderJsOptions } from './jsOptions';
import type { CodegenModel, FileParam } from './model';

// JavaScript renderers. Two audiences share one options body (from ./jsOptions):
//   • renderJavaScriptNode  — an ESM script; file inputs are { path: '…' }.
//   • renderJavaScriptBrowser — a self-contained HTML page; file inputs are File objects from
//     <input type="file">, engine loaded from the esm.sh CDN.
// See scripts/reproduce/validate.mjs and validate-browser.html for the verified references.

const RESULT_LINES_JS = [
  'const cal = v.calibration.absoluteRisk;',
  'console.log(`AUC = ${v.auc.auc.toFixed(4)}  [${v.auc.lowerCi.toFixed(4)}, ${v.auc.upperCi.toFixed(4)}]`);',
  'console.log(`E/O ratio = ${v.expectedByObservedRatio.ratio.toFixed(4)}`);',
  'console.log(`Hosmer-Lemeshow chi-square = ${cal.statistic.chiSquare.toFixed(4)} (df ${cal.parameter.degreesOfFreedom})`);',
];

export function renderJavaScriptNode(model: CodegenModel): string {
  const lines: string[] = [];
  lines.push('// Reproduce this iCARE model validation in Node.js with wasm-icare.');
  lines.push('//');
  lines.push('//   npm install wasm-icare');
  lines.push('//   node validate.mjs');
  lines.push('//');
  lines.push(
    '// File inputs are filesystem paths — EDIT the paths (marked "EDIT path") to your files.',
  );
  lines.push('// The engine loads from node_modules; scientific wheels download once and cache.');
  for (const w of model.warnings) lines.push(`// NOTE: ${w}`);
  lines.push("import { loadICARE } from 'wasm-icare';");
  lines.push('');
  lines.push('const icare = await loadICARE();');
  lines.push('const v = await icare.validateAbsoluteRiskModel({');
  lines.push(
    ...renderJsOptions(model, '  ', (p) => ({
      expr: `{ path: ${JSON.stringify(p.filename)} }`,
      comment: 'EDIT path',
    })),
  );
  lines.push('});');
  lines.push('await icare.close();');
  lines.push('');
  lines.push(...RESULT_LINES_JS);
  return lines.join('\n') + '\n';
}

/** A readable label from a camelCase key, e.g. modelDiseaseIncidenceRates -> "Model disease incidence rates". */
function humanLabel(jsKey: string): string {
  const words = jsKey
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function renderJavaScriptBrowser(model: CodegenModel): string {
  const fileParams = [...model.top, ...model.model].filter(
    (p): p is FileParam => p.type === 'file',
  );
  const inputs = fileParams
    .map(
      (p) =>
        `      <label><span>${humanLabel(p.jsKey)}</span>` +
        `<input type="file" id="${p.jsKey}" /> <small>(${escapeHtml(p.filename)})</small></label>`,
    )
    .join('\n');

  const optionBody = renderJsOptions(model, '            ', (p) => ({
    expr: `fileOf(${JSON.stringify(p.jsKey)})`,
  })).join('\n');

  const warnings = model.warnings.map((w) => `    <!-- NOTE: ${escapeHtml(w)} -->`).join('\n');

  return `<!doctype html>
<!--
  Reproduce this iCARE model validation in the BROWSER with wasm-icare.
  Loads the engine (Pyodide + pyicare) from the jsDelivr CDN via esm.sh — needs internet the first time
  (~40 MB, ~20-30 s). Nothing is uploaded; files are read locally. Serve over http(s) (e.g. \`npx serve\`),
  pick each file, then click Run. For a fully offline page, self-host a Pyodide mirror and pass
  indexURL/pyicareWheelUrl to loadICARE() (see the wasm-icare README).
-->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>iCARE model validation (browser)</title>
    <style>
      body { font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      label { display: block; margin: 0.5rem 0; }
      label span { display: inline-block; min-width: 20rem; }
      button { font-size: 1rem; padding: 0.5rem 1rem; margin-top: 1rem; cursor: pointer; }
      pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 0.75rem; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>iCARE model validation (browser)</h1>
    <p>Choose each file, then click <b>Run validation</b>. Files never leave your browser.</p>
${warnings ? warnings + '\n' : ''}    <form id="inputs">
${inputs}
    </form>
    <button id="run">Run validation</button>
    <pre id="status">Idle.</pre>
    <pre id="output"></pre>

    <script type="module">
      import { loadICARE } from 'https://esm.sh/wasm-icare@2';

      const fileOf = (id) => {
        const f = document.getElementById(id).files[0];
        if (!f) throw new Error('Please choose a file for "' + id + '".');
        return f; // a File is a Blob — a valid SDK input
      };

      document.getElementById('run').addEventListener('click', async () => {
        const status = document.getElementById('status');
        const output = document.getElementById('output');
        output.textContent = '';
        try {
          status.textContent = 'Booting engine from the CDN… ~20-30 s the first time…';
          const icare = await loadICARE();
          status.textContent = 'Engine ready. Validating…';
          const v = await icare.validateAbsoluteRiskModel({
${optionBody}
          });
          await icare.close();
          status.textContent = 'Done.';
          const cal = v.calibration.absoluteRisk;
          output.textContent =
            'AUC = ' + v.auc.auc.toFixed(4) + '  [' + v.auc.lowerCi.toFixed(4) + ', ' + v.auc.upperCi.toFixed(4) + ']\\n' +
            'E/O ratio = ' + v.expectedByObservedRatio.ratio.toFixed(4) + '\\n' +
            'Hosmer-Lemeshow chi-square = ' + cal.statistic.chiSquare.toFixed(4) + ' (df ' + cal.parameter.degreesOfFreedom + ')';
        } catch (err) {
          status.textContent = 'Error';
          output.textContent = String((err && err.stack) || err);
        }
      });
    </script>
  </body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}
