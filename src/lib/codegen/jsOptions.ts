import type { CodegenModel, FileParam, Param } from './model';

// The camelCase options object passed to `validateAbsoluteRiskModel(...)`, shared by every JS-flavoured
// renderer (Node, browser, and the R/OJS cell). Only how a FILE input is expressed differs per target
// (a { path }, a File, or a Blob), so callers pass a `fileExpr`; the rest of the object is identical —
// which is exactly why the three languages stay in lock-step.

export function jsLiteral(value: string | number | boolean | number[]): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length > 30
      ? `[/* ${value.length} values — paste them */]`
      : `[${value.join(', ')}]`;
  }
  return String(value);
}

export interface FileExpr {
  expr: string;
  comment?: string;
}

/** Inner lines of the options object (between the braces), indented by `indent`; files via `fileExpr`. */
export function renderJsOptions(
  model: CodegenModel,
  indent: string,
  fileExpr: (p: FileParam) => FileExpr,
): string[] {
  const out: string[] = [];
  const emit = (p: Param, ind: string) => {
    if (p.type === 'file') {
      const r = fileExpr(p);
      out.push(`${ind}${p.jsKey}: ${r.expr},${r.comment ? `  // ${r.comment}` : ''}`);
    } else if (p.type === 'vector') {
      const src = p.filename ? ` from ${JSON.stringify(p.filename)}` : '';
      out.push(`${ind}${p.jsKey}: [/* EDIT */],  // ${p.count} values${src}`);
    } else {
      out.push(`${ind}${p.jsKey}: ${jsLiteral(p.value)},`);
    }
  };

  const [study, interval, ...rest] = model.top;
  emit(study, indent);
  emit(interval, indent);
  if (model.model.length > 0) {
    out.push(`${indent}icareModelParameters: {`);
    for (const p of model.model) emit(p, indent + '  ');
    out.push(`${indent}},`);
  }
  for (const p of rest) emit(p, indent);
  out.push(`${indent}numberOfPercentiles: ${model.numberOfPercentiles},`);
  out.push(`${indent}seed: ${model.seed},`);
  if (model.datasetName) out.push(`${indent}datasetName: ${JSON.stringify(model.datasetName)},`);
  if (model.modelName) out.push(`${indent}modelName: ${JSON.stringify(model.modelName)},`);
  return out;
}
