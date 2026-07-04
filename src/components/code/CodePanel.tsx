import { useMemo, useState } from 'react';
import { useBinSettingsStore } from '../../state/binSettingsStore';
import { canBuildValidateOptions, useInputStore } from '../../state/inputStore';
import { generateCode, type CodeLanguage } from '../../lib/codegen';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CodeBlock } from './CodeBlock';

// The "Code" tab: copyable Python / JavaScript / R code that reproduces the current validation in the
// user's own environment. Generated live from the input + bin-settings stores (mirrors the app's own
// buildValidateOptions), so it always reflects the current configuration. Reachable once the inputs are
// valid — no run required, since the code is a pure function of the inputs.

type Lang = 'python' | 'javascript' | 'r';
type JsTarget = 'node' | 'browser';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'r', label: 'R (Quarto)' },
];

const INTRO: Record<CodeLanguage, string> = {
  python:
    'Runs natively with py-icare on CPython. Install with `pip install pyicare`, then `python validate.py`.',
  'javascript-node':
    'Runs in Node.js with the wasm-icare npm package (`npm install wasm-icare`), then `node validate.mjs`.',
  'javascript-browser':
    'A self-contained HTML page that loads wasm-icare from the esm.sh CDN. Serve it over http(s), open it, then choose your files.',
  r: 'A Quarto notebook: an R chunk serializes each file to an {ojs} cell that runs wasm-icare in your browser. Render with `quarto render`.',
};

const toggleRow: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const introStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--app-muted)',
  margin: '12px 0',
  lineHeight: 1.5,
};

export function CodePanel() {
  const [lang, setLang] = useState<Lang>('python');
  const [jsTarget, setJsTarget] = useState<JsTarget>('node');

  const input = useInputStore();
  const binSettings = useBinSettingsStore();
  const ready = canBuildValidateOptions(input);

  const codeLang: CodeLanguage =
    lang === 'javascript' ? (jsTarget === 'node' ? 'javascript-node' : 'javascript-browser') : lang;

  const generated = useMemo(
    () => generateCode(codeLang, input, binSettings),
    [codeLang, input, binSettings],
  );

  if (!ready) {
    return (
      <Card style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Reproduce this validation</h2>
        <p style={{ color: 'var(--app-muted)', margin: 0 }}>
          Add the required inputs on the <strong>Input</strong> tab first. Once your validation is
          set up, this tab shows copyable Python, JavaScript, and R code that reproduces it in your
          own environment.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Reproduce this validation</h2>
      <p style={{ color: 'var(--app-muted)', marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
        Generated from your current inputs. Files are referenced by name — edit the paths (marked{' '}
        <code>EDIT</code>) to match your workspace.
      </p>

      <div style={toggleRow} role="tablist" aria-label="Language">
        {LANGS.map((l) => (
          <Button
            key={l.id}
            variant="toggle"
            active={lang === l.id}
            aria-selected={lang === l.id}
            role="tab"
            onClick={() => setLang(l.id)}
            style={{ padding: '6px 12px', fontSize: 13 }}
          >
            {l.label}
          </Button>
        ))}
      </div>

      {lang === 'javascript' && (
        <div style={{ ...toggleRow, marginTop: 8 }} aria-label="JavaScript target">
          {(['node', 'browser'] as JsTarget[]).map((t) => (
            <Button
              key={t}
              variant="toggle"
              active={jsTarget === t}
              onClick={() => setJsTarget(t)}
              style={{ padding: '4px 10px' }}
            >
              {t === 'node' ? 'Node.js' : 'Browser (CDN)'}
            </Button>
          ))}
        </div>
      )}

      <p style={introStyle}>{INTRO[codeLang]}</p>

      <CodeBlock code={generated.code} filename={generated.filename} />
    </div>
  );
}
