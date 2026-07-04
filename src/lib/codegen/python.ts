import { PYICARE_VERSION } from '../icareTypes';
import { pyName, type CodegenModel, type Param } from './model';

// Python renderer: a runnable `py-icare` script that mirrors the app's validation call. File inputs are
// referenced by name with an `EDIT path` marker; every optional the app omits is omitted here too, so
// py-icare applies the same defaults. See scripts/reproduce/validate.py for the verified reference.

function pyLiteral(value: string | number | boolean | number[]): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return renderNumberArray(value, '[', ']');
  return String(value);
}

/** Inline small arrays; for big ones (per-subject ages) emit a placeholder the user fills in. */
function renderNumberArray(values: number[], open: string, close: string): string {
  if (values.length > 30)
    return `${open}...${close}  # ${values.length} values — paste or load them`;
  return `${open}${values.join(', ')}${close}`;
}

function pyFileComment(): string {
  return '  # EDIT path';
}

/** Render one param as a `key=value` kwarg line at the given indent (no trailing comma). */
function renderParam(param: Param, indentUnit: string, keyRender: (p: Param) => string): string {
  const key = keyRender(param);
  if (param.type === 'file')
    return `${indentUnit}${key}=${JSON.stringify(param.filename)},${pyFileComment()}`;
  if (param.type === 'vector') {
    const src = param.filename ? ` from ${JSON.stringify(param.filename)}` : '';
    return `${indentUnit}${key}=[...],  # EDIT: ${param.count} values${src}`;
  }
  return `${indentUnit}${key}=${pyLiteral(param.value)},`;
}

export function renderPython(model: CodegenModel): string {
  const lines: string[] = [];
  lines.push(
    '"""Reproduce this iCARE model validation with py-icare (https://github.com/jeyabbalas/py-icare).',
  );
  lines.push('');
  lines.push(
    '    pip install pyicare            # also `pip install packaging` if patsy complains',
  );
  lines.push('    python validate.py');
  lines.push('');
  lines.push(
    `Uses pyicare ${PYICARE_VERSION} — the same package the app runs inside Pyodide, so the numbers match.`,
  );
  lines.push('EDIT the file paths (marked "EDIT path") to point at the files in your workspace.');
  lines.push('"""');
  lines.push('');
  for (const w of model.warnings) lines.push(`# NOTE: ${w}`);
  if (model.warnings.length) lines.push('');
  lines.push('from icare import validate_absolute_risk_model');
  lines.push('');
  lines.push('result = validate_absolute_risk_model(');

  const [study, interval, ...rest] = model.top;
  lines.push(renderParam(study, '    ', pyName));
  lines.push(renderParam(interval, '    ', pyName));

  if (model.model.length > 0) {
    lines.push('    icare_model_parameters={');
    for (const p of model.model) lines.push(renderModelDictEntry(p));
    lines.push('    },');
  }

  for (const p of rest) lines.push(renderParam(p, '    ', pyName));
  lines.push(`    number_of_percentiles=${model.numberOfPercentiles},`);
  lines.push(`    seed=${model.seed},`);
  if (model.datasetName) lines.push(`    dataset_name=${JSON.stringify(model.datasetName)},`);
  if (model.modelName) lines.push(`    model_name=${JSON.stringify(model.modelName)},`);
  lines.push(')');
  lines.push('');
  lines.push('auc = result["auc"]');
  lines.push('cal = result["calibration"]["absolute_risk"]');
  lines.push("print(f\"AUC = {auc['auc']:.4f}  [{auc['lower_ci']:.4f}, {auc['upper_ci']:.4f}]\")");
  lines.push("print(f\"E/O ratio = {result['expected_by_observed_ratio']['ratio']:.4f}\")");
  lines.push(
    "print(f\"Hosmer-Lemeshow chi-square = {cal['statistic']['chi_square']:.4f} (df {cal['parameter']['degrees_of_freedom']})\")",
  );
  return lines.join('\n') + '\n';
}

/** A nested `icare_model_parameters` entry uses a string key: `"..._path": "...",`. */
function renderModelDictEntry(param: Param): string {
  const key = JSON.stringify(pyName(param));
  if (param.type === 'file')
    return `        ${key}: ${JSON.stringify(param.filename)},${pyFileComment()}`;
  if (param.type === 'vector') return `        ${key}: [...],  # EDIT: ${param.count} values`;
  return `        ${key}: ${pyLiteral(param.value)},`;
}
