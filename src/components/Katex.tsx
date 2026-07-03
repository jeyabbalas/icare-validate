import { useEffect, useRef } from 'react';

// Leaf renderer that typesets a LaTeX string with KaTeX. KaTeX (~300 KB) and its stylesheet are
// dynamically imported once, on first use, via a module-memoized promise — so they stay out of the
// initial bundle and every instance shares the same load (the model view can mount ~80 of these).
// KaTeX renders synchronously into a ref (house style: imperative libs mount into a ref, cf.
// DataTablePanel); there is no worker and nothing to destroy. `throwOnError:false` means malformed
// input renders a red error node instead of crashing; a failed dynamic import degrades to the raw
// source text.

type KatexModule = (typeof import('katex'))['default'];

let katexMod: KatexModule | null = null;
let katexPromise: Promise<KatexModule> | null = null;

function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
      katexMod = m.default;
      return m.default;
    });
  }
  return katexPromise;
}

const KATEX_OPTS = {
  throwOnError: false,
  output: 'html',
  strict: 'ignore',
  errorColor: '#dc2626',
} as const;

export interface KatexProps {
  tex: string;
  displayMode?: boolean;
  ariaLabel?: string;
}

export function Katex({ tex, displayMode = false, ariaLabel }: KatexProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    const render = (k: KatexModule): void => {
      const el = ref.current;
      if (cancelled || !el) return;
      try {
        k.render(tex, el, { ...KATEX_OPTS, displayMode });
      } catch {
        el.textContent = tex;
      }
    };
    if (katexMod) {
      render(katexMod);
    } else {
      loadKatex()
        .then(render)
        .catch(() => {
          if (!cancelled && ref.current) ref.current.textContent = tex;
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tex, displayMode]);

  return (
    <span
      ref={ref}
      className="katex-host"
      role="math"
      aria-label={ariaLabel ?? tex}
      style={displayMode ? { display: 'block', overflowX: 'auto', maxWidth: '100%' } : undefined}
    >
      {tex}
    </span>
  );
}
