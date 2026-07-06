import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataTable } from '@jeyabbalas/data-table';
import { useAppStore } from '../state/appStore';
import { DUCKDB_BUNDLES } from '../lib/duckdbBundles';

// First imperative-DOM wrapper in the app: mounts @jeyabbalas/data-table (DuckDB-WASM backed) into
// a ref and tears it down on unmount. Store-agnostic (props in, no store reads except the theme) so
// it can be reused for any tabular File/URL. The heavy library + DuckDB are lazy-imported inside the
// effect, so nothing table-related lands in the initial bundle.

type Status = 'loading' | 'ready' | 'unsupported' | 'error';

export interface DataTablePanelProps {
  /** CSV/TSV as a File (Blob) — or a base-relative URL string for URL-backed slots. */
  source: File | string;
  /** Stable DuckDB table name (the parent also derives the React `key` from the source identity). */
  tableName: string;
  /** Optional caption above the table (e.g. the file name). */
  title?: string;
  /**
   * Fixed pixel height of the table viewport. A DEFINITE height (not min-height) is required: the
   * library virtualizes rows inside `.dt-body-scroll` (flex:1; overflow:auto), and `.dt-root` is
   * `height:100%` — so without a bounded host the whole chain falls back to content height and renders
   * EVERY row (very slow on large datasets). Bounding the host activates the internal scroll + row
   * virtualization, so cost stays constant regardless of row count.
   */
  height?: number;
}

export function DataTablePanel({ source, tableName, title, height = 480 }: DataTablePanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<DataTable | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const theme = useAppStore((s) => s.theme);

  // Build (or rebuild) the table when the source / table name changes. NOT on theme (see below).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let instance: DataTable | undefined;
    setStatus('loading');
    setErrorMsg(null);

    void (async () => {
      try {
        // Lazy: keep @jeyabbalas/data-table + DuckDB-WASM (and its CSS) out of the initial bundle.
        const [mod] = await Promise.all([
          import('@jeyabbalas/data-table'),
          import('@jeyabbalas/data-table/styles'),
        ]);
        if (cancelled) return;

        const support = mod.checkBrowserSupport();
        if (!support.supported) {
          setMissing(support.missing);
          setStatus('unsupported');
          return;
        }

        const table = await mod.createDataTable({
          container: host,
          source,
          tableName,
          // Offline: self-hosted mvp+eh bundles instead of jsDelivr (no coi ⇒ no SharedArrayBuffer).
          bridgeOptions: { duckdbBundles: DUCKDB_BUNDLES, initializeTimeoutMs: 60_000 },
          colorScheme: theme, // matches the app on first paint; live-synced by the theme effect below
          // Core preview scope: sort, per-column filter, column visualizations, export.
          persistence: false, // no cross-dataset IndexedDB state bleed between previews
          presets: false, // presets also persist — keep previews fully stateless
          expressionFilter: false, // raw-SQL editor needs CodeMirror — off
          derivedColumns: false, // computed-column UI needs CodeMirror — off
          visualizations: true,
          exportDialog: true,
        });

        // StrictMode / fast-nav guard: if we were unmounted while createDataTable was still pending,
        // the cleanup below already ran with `instance` undefined and destroyed nothing. Destroy the
        // just-resolved table here so we never leak a live DuckDB worker.
        if (cancelled) {
          void table.destroy();
          return;
        }
        instance = table;
        instanceRef.current = table;
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(mapDataTableError(err));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      instanceRef.current = null;
      if (instance && !instance.isDestroyed()) void instance.destroy();
    };
    // `theme` is intentionally omitted: a theme change must NOT tear down / rebuild the table — the
    // separate effect below syncs it live via setColorScheme().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, tableName]);

  // Live theme sync without a rebuild.
  useEffect(() => {
    const table = instanceRef.current;
    if (table && !table.isDestroyed()) table.setColorScheme(theme);
  }, [theme]);

  return (
    <div>
      {title && (
        <h3
          title={title}
          style={{
            margin: '0 0 8px',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--app-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </h3>
      )}
      <div style={{ position: 'relative', height }}>
        <div ref={hostRef} className="dt-preview-host" style={{ height }} />
        {status === 'loading' && <Overlay>Loading table engine…</Overlay>}
        {status === 'unsupported' && (
          <Overlay tone="muted">
            This browser can’t run the in-page database (DuckDB-WASM)
            {missing.length > 0 ? `: missing ${missing.join(', ')}` : ''}. Try a current version of
            Chrome, Edge, Firefox, or Safari.
          </Overlay>
        )}
        {status === 'error' && <Overlay tone="danger">⚠ {errorMsg}</Overlay>}
      </div>
    </div>
  );
}

function Overlay({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        textAlign: 'center',
        fontSize: 13,
        background: 'var(--app-surface)',
        color: tone === 'danger' ? 'var(--app-danger)' : 'var(--app-muted)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
      }}
    >
      {children}
    </div>
  );
}

/** Turn an offline cache-miss / timeout into an actionable message (mirrors icareService.mapError). */
function mapDataTableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out/i.test(raw)) {
    return 'The in-page database took too long to start. Reload the page; if it persists, your device may be low on memory.';
  }
  if (/fetch|network|404|failed to load|worker|wasm/i.test(raw)) {
    return 'Could not load the DuckDB engine files. On a fresh checkout run `npm run vendor`; otherwise the assets may not have been cached before going offline.';
  }
  return raw || 'Could not open the data table.';
}
