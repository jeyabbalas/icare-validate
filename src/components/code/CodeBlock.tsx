import { useEffect, useRef, useState } from 'react';
import { downloadText } from '../../lib/resultsExport';
import { Button } from '../ui/Button';

// A read-only code block with Copy + Download actions. Reuses the DevInspector's `surface-2` <pre> look
// (monospace, bordered, horizontally scrollable). No syntax highlighter — CodeMirror is stubbed out at
// build time, and shipping one would bloat the offline bundle for little gain.

interface CodeBlockProps {
  code: string;
  filename: string;
}

const preStyle: React.CSSProperties = {
  background: 'var(--app-surface-2)',
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  margin: 0,
  overflowX: 'auto',
  maxHeight: 560,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12.5,
  lineHeight: 1.55,
  tabSize: 2,
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginBottom: 8,
};

export function CodeBlock({ code, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (e.g. insecure context) — fail silently; Download still works.
    }
  };

  return (
    <div>
      <div style={toolbarStyle}>
        <Button variant="secondary" onClick={copy} aria-live="polite">
          {copied ? 'Copied ✓' : 'Copy'}
        </Button>
        <Button variant="secondary" onClick={() => downloadText(code, filename)}>
          Download {filename}
        </Button>
      </div>
      <pre style={preStyle}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
