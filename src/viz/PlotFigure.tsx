import { useEffect, useRef, useState } from 'react';
import { downloadPng, downloadSvg } from '../lib/figureExport';

// Generic host for an Observable Plot figure — the app's shared chart wrapper (later viz phases reuse
// it). Follows the house imperative-lib pattern (cf. Katex.tsx / DataTablePanel.tsx): the ~150 KB Plot
// module is dynamically imported once via a module-memoized promise (kept out of the initial bundle),
// the caller's `render(Plot, {width})` closure draws a bare <svg> that we mount into a ref, and the
// figure re-renders whenever `deps` (data / theme / units) or the measured width change — Plot output
// is immutable, so a theme flip is a full re-render, not a live restyle. Download SVG / PNG read the
// live svg node. `render` is held in a ref so a fresh closure each React render never goes stale and
// never forces a rebuild; the curated `deps` array is what drives rebuilds.

type PlotModule = typeof import('@observablehq/plot');

let plotMod: PlotModule | null = null;
let plotPromise: Promise<PlotModule> | null = null;

function loadPlot(): Promise<PlotModule> {
  if (!plotPromise) {
    plotPromise = import('@observablehq/plot').then((m) => {
      plotMod = m;
      return m;
    });
  }
  return plotPromise;
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

export interface PlotFigureProps {
  /** Draw the figure as a bare <svg> at the given width, or return null when there's nothing to plot. */
  render: (Plot: PlotModule, ctx: { width: number }) => SVGSVGElement | null;
  /** Rebuild triggers — data identity, theme, units, etc. MUST be a stable-length array. */
  deps: React.DependencyList;
  /** Base filename (no extension) for the SVG / PNG downloads. */
  exportName: string;
  /** Solid backdrop painted under the PNG (usually the resolved surface color) so it isn't transparent. */
  pngBackground?: string;
  /** Optional controls (e.g. a units toggle) shown at the left of the toolbar, beside the download buttons. */
  toolbarExtras?: React.ReactNode;
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};

const btnStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface-2)',
  color: 'var(--app-fg)',
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontSize: 13,
  color: 'var(--app-muted)',
  pointerEvents: 'none',
};

export function PlotFigure({ render, deps, exportName, pngBackground, toolbarExtras }: PlotFigureProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const renderRef = useRef(render);
  renderRef.current = render; // latest closure, captured before the effects run

  const [width, setWidth] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Responsive width: measure the host and re-render on meaningful size changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      setWidth((prev) => (w > 0 && Math.abs(prev - w) >= 8 ? w : prev));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Draw / redraw whenever the width or the caller's deps change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || width === 0) return;
    let cancelled = false;

    const mount = (Plot: PlotModule): void => {
      if (cancelled || !hostRef.current) return;
      try {
        const svg = renderRef.current(Plot, { width });
        if (!svg) {
          hostRef.current.replaceChildren();
          svgRef.current = null;
          setStatus('empty');
          return;
        }
        hostRef.current.replaceChildren(svg); // replaces any prior svg — no node leak
        svgRef.current = svg;
        setErrorMsg(null);
        setStatus('ready');
      } catch (err) {
        svgRef.current = null;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    };

    if (plotMod) {
      mount(plotMod); // already loaded → synchronous, no flicker
    } else {
      setStatus('loading');
      loadPlot()
        .then((Plot) => {
          if (!cancelled) mount(Plot);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus('error');
        });
    }

    return () => {
      cancelled = true;
      svgRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, ...deps]);

  const ready = status === 'ready';
  const onSvg = (): void => {
    if (svgRef.current) downloadSvg(svgRef.current, `${exportName}.svg`);
  };
  const onPng = (): void => {
    if (svgRef.current) void downloadPng(svgRef.current, `${exportName}.png`, { background: pngBackground });
  };

  return (
    <div>
      <div style={toolbarStyle}>
        <div>{toolbarExtras}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={btnStyle}
            onClick={onSvg}
            disabled={!ready}
            aria-label="Download chart as SVG"
          >
            ⬇ SVG
          </button>
          <button
            type="button"
            style={btnStyle}
            onClick={onPng}
            disabled={!ready}
            aria-label="Download chart as PNG"
          >
            ⬇ PNG
          </button>
        </div>
      </div>
      <div style={{ position: 'relative', minHeight: 200 }}>
        <div ref={hostRef} style={{ width: '100%', overflowX: 'auto' }} />
        {status === 'loading' && <div style={overlayStyle}>Loading chart…</div>}
        {status === 'empty' && <div style={overlayStyle}>No rates to plot.</div>}
        {status === 'error' && (
          <div style={{ ...overlayStyle, color: 'var(--app-danger)' }}>⚠ {errorMsg}</div>
        )}
      </div>
    </div>
  );
}
