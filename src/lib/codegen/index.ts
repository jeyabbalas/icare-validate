import { renderJavaScriptBrowser, renderJavaScriptNode } from './javascript';
import { buildCodegenModel, type BinSettings, type CodegenModel } from './model';
import { renderPython } from './python';
import { renderRQuarto } from './rQuarto';
import type { InputState } from '../../state/inputStore';

export * from './model';
export { renderPython } from './python';
export { renderJavaScriptNode, renderJavaScriptBrowser } from './javascript';
export { renderRQuarto } from './rQuarto';

// The languages/targets the "Code" tab offers. JavaScript splits by audience (Node vs browser).
export type CodeLanguage = 'python' | 'javascript-node' | 'javascript-browser' | 'r';

export interface GeneratedCode {
  code: string;
  /** Suggested download filename. */
  filename: string;
  /** A hint for a future syntax highlighter / the <pre> class. */
  syntax: 'python' | 'javascript' | 'html' | 'markdown';
}

const RENDERERS: Record<
  CodeLanguage,
  { render: (m: CodegenModel) => string; filename: string; syntax: GeneratedCode['syntax'] }
> = {
  python: { render: renderPython, filename: 'validate.py', syntax: 'python' },
  'javascript-node': {
    render: renderJavaScriptNode,
    filename: 'validate.mjs',
    syntax: 'javascript',
  },
  'javascript-browser': {
    render: renderJavaScriptBrowser,
    filename: 'validate.html',
    syntax: 'html',
  },
  r: { render: renderRQuarto, filename: 'validate.qmd', syntax: 'markdown' },
};

/** Render the reproduction code for one language directly from the input + bin-settings state. */
export function generateCode(
  lang: CodeLanguage,
  input: InputState,
  binSettings: BinSettings,
): GeneratedCode {
  const model = buildCodegenModel(input, binSettings);
  const r = RENDERERS[lang];
  return { code: r.render(model), filename: r.filename, syntax: r.syntax };
}
