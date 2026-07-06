import { useEffect, useState } from 'react';
import { readDelimited, readFormula, readLogOddsRatios } from '../../lib/csvIngest';
import { fileKey, slotToFile } from '../../lib/slotFiles';
import {
  buildModel,
  formatNumber,
  type CoefGroup,
  type CoefRow,
  type InteractionMatrix,
  type Model,
} from '../../math/patsyToLatex';
import { slotFilled, useInputStore, type FileSlot } from '../../state/inputStore';
import { Katex } from '../Katex';

// Mode-A input display: the covariate model rendered as an equation + coefficient table. Reads the raw
// formula (.txt) and log-relative-risk (.json) File slots, parses them client-side, and renders via the
// pure `buildModel` engine + KaTeX. Large models stay legible: a fixed one-line hero equation, the
// coefficients split into collapsible per-variable groups (big ones collapsed), a cat×cat interaction
// shown as a compact grid, and the fully-expanded equation behind a lazy toggle.

// ---- styles ----------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  marginBottom: 16,
};
const cardTitle: React.CSSProperties = { margin: '0 0 10px', fontSize: 14 };
const groupStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: '8px 10px',
  background: 'var(--app-surface-2)',
  marginBottom: 8,
};
const groupSummary: React.CSSProperties = { cursor: 'pointer', fontSize: 13 };
const tableStyle: React.CSSProperties = { borderCollapse: 'collapse', width: '100%', fontSize: 13 };
const thLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--app-border)',
  color: 'var(--app-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
const thRight: React.CSSProperties = { ...thLeft, textAlign: 'right' };
const tdLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--app-border)',
  verticalAlign: 'top',
};
const tdNum: React.CSSProperties = {
  textAlign: 'right',
  padding: '4px 8px',
  borderBottom: '1px solid var(--app-border)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  verticalAlign: 'top',
};
const refRowStyle: React.CSSProperties = { color: 'var(--app-muted)' };
const keySubtext: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--app-muted)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  wordBreak: 'break-all',
  marginTop: 2,
};
const mutedNote: React.CSSProperties = { fontSize: 12, color: 'var(--app-muted)' };
const toggleBtn: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  background: 'var(--app-surface)',
  color: 'var(--app-fg)',
  padding: '2px 8px',
  fontSize: 12,
};

type EqState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; errors: string[] }
  | { status: 'ready'; model: Model };

/** Re-parse the formula + log-OR files into a renderable model whenever either File changes. */
function useModelEquation(formulaSlot: FileSlot, logOrSlot: FileSlot): EqState {
  const [state, setState] = useState<EqState>({ status: 'empty' });
  const logKey = fileKey(logOrSlot);
  const formulaKey = fileKey(formulaSlot);

  useEffect(() => {
    let cancelled = false;
    if (!slotFilled(logOrSlot)) {
      setState({ status: 'empty' });
      return;
    }
    setState({ status: 'loading' });
    void (async () => {
      const lor = await readLogOddsRatios(await slotToFile(logOrSlot));
      if (cancelled) return;
      if (!lor.ok) {
        setState({ status: 'error', errors: lor.errors });
        return;
      }
      let formulaText: string | null = null;
      if (slotFilled(formulaSlot)) {
        const fr = await readFormula(await slotToFile(formulaSlot));
        if (cancelled) return;
        formulaText = fr.text || null;
      }
      if (!cancelled) setState({ status: 'ready', model: buildModel(lor.map, formulaText) });
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', errors: [e instanceof Error ? e.message : String(e)] });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logKey, formulaKey]);

  return state;
}

// ---- section ---------------------------------------------------------------

export function ModelEquationSection() {
  const mode = useInputStore((s) => s.mode);
  const formulaSlot = useInputStore((s) => s.modelFiles.modelCovariateFormula);
  const logOrSlot = useInputStore((s) => s.modelFiles.modelLogRelativeRisk);
  const snpSlot = useInputStore((s) => s.modelFiles.modelSnpInfo);
  const predictedRisk = useInputStore((s) => s.predictedRiskVariableName);
  const linearPredictor = useInputStore((s) => s.linearPredictorVariableName);

  if (mode === 'B') {
    return (
      <div style={cardStyle}>
        <h2 style={cardTitle}>Model</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--app-muted)' }}>
          Pre-computed mode: the model is not rebuilt from a formula. Predicted absolute risk is read
          from column <code>{predictedRisk || '—'}</code> and the linear predictor from{' '}
          <code>{linearPredictor || '—'}</code> in your study data.
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h2 style={cardTitle}>Model</h2>
      <ModelEquationBody formulaSlot={formulaSlot} logOrSlot={logOrSlot} />
      {slotFilled(snpSlot) && <SnpPanel slot={snpSlot} />}
    </div>
  );
}

function ModelEquationBody({
  formulaSlot,
  logOrSlot,
}: {
  formulaSlot: FileSlot;
  logOrSlot: FileSlot;
}) {
  const state = useModelEquation(formulaSlot, logOrSlot);
  if (state.status === 'empty') {
    return (
      <Placeholder>
        Load the log relative risks (β) file — and, optionally, the covariate formula — to see the
        model equation.
      </Placeholder>
    );
  }
  if (state.status === 'loading') return <Placeholder>Building the model equation…</Placeholder>;
  if (state.status === 'error') return <ErrorBox errors={state.errors} />;
  return <ModelView model={state.model} />;
}

function ModelView({ model }: { model: Model }) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Katex tex={model.compactLatex} displayMode />
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            gap: 12,
            alignItems: 'baseline',
            flexWrap: 'wrap',
            ...mutedNote,
          }}
        >
          <Katex tex={model.scaleNoteLatex} />
          <span>
            Relative risk multiplies across covariates; coefficients are on the log scale. Reference
            levels are absorbed into the baseline.
          </span>
        </div>
      </div>

      {model.warnings.map((w, i) => (
        <WarnLine key={i}>{w}</WarnLine>
      ))}

      {model.groups.map((g) => (
        <GroupBlock key={g.id} group={g} />
      ))}

      <ExpandedEquation model={model} />
    </div>
  );
}

function countLabel(group: CoefGroup): string {
  const n = group.rows.filter((r) => !r.isReference).length;
  return `${n} term${n === 1 ? '' : 's'}`;
}

function GroupBlock({ group }: { group: CoefGroup }) {
  const defaultOpen = group.rows.length <= 12;
  return (
    <details open={defaultOpen} style={groupStyle}>
      <summary style={groupSummary}>
        <span style={{ fontWeight: 600 }}>{group.title}</span>
        <span style={{ marginLeft: 8, ...mutedNote, fontWeight: 400 }}>
          {group.kind === 'interaction' ? 'interaction · ' : ''}
          {countLabel(group)}
          {group.referenceNote ? ` · ${group.referenceNote}` : ''}
        </span>
      </summary>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        {group.matrix ? <MatrixTable matrix={group.matrix} /> : <RowsTable rows={group.rows} />}
      </div>
      {group.warnings.map((w, i) => (
        <WarnLine key={i}>{w}</WarnLine>
      ))}
    </details>
  );
}

function RowsTable({ rows }: { rows: CoefRow[] }) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thLeft}>Covariate</th>
          <th style={thLeft}>Description</th>
          <th style={thRight}>β (log RR)</th>
          <th style={thRight}>RR = e^β</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key ?? `ref:${i}`} style={r.isReference ? refRowStyle : undefined}>
            <td style={tdLeft}>
              {r.covariateLatex ? (
                <Katex tex={r.covariateLatex} />
              ) : (
                <span style={{ color: 'var(--app-muted)' }}>—</span>
              )}
            </td>
            <td style={tdLeft}>
              <div>{r.label}</div>
              {r.key && (
                <div style={keySubtext} title={r.key}>
                  {r.key}
                </div>
              )}
            </td>
            <td style={tdNum} title={r.isReference ? 'baseline' : String(r.beta)}>
              {formatNumber(r.beta)}
            </td>
            <td style={tdNum} title={r.isReference ? 'baseline' : String(r.expBeta)}>
              {formatNumber(r.expBeta)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MatrixTable({ matrix }: { matrix: InteractionMatrix }) {
  const [showExp, setShowExp] = useState(false);
  return (
    <div>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}
      >
        <span style={mutedNote}>
          columns: {matrix.colVar} · rows: {matrix.rowVar}
        </span>
        <button type="button" onClick={() => setShowExp((v) => !v)} style={toggleBtn}>
          Show {showExp ? 'β (log RR)' : 'RR = e^β'}
        </button>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thLeft} />
            {matrix.colLevelLatex.map((colTex, ci) => (
              <th key={ci} style={thRight}>
                <Katex tex={colTex} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rowLevelLatex.map((rowTex, ri) => (
            <tr key={ri}>
              <th style={thLeft}>
                <Katex tex={rowTex} />
              </th>
              {matrix.colLevels.map((_colLvl, ci) => {
                const cell = matrix.cell(ri, ci);
                return (
                  <td key={ci} style={tdNum} title={cell?.key ?? ''}>
                    {cell ? formatNumber(showExp ? cell.expBeta : cell.beta) : '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ ...mutedNote, margin: '6px 0 0' }}>
        Reference row/column (β = 0, RR = 1) omitted. Cells are the interaction coefficient beyond the
        main effects.
      </p>
    </div>
  );
}

function ExpandedEquation({ model }: { model: Model }) {
  const [visited, setVisited] = useState(false);
  const defaultOpen = model.termCount <= 12;
  return (
    <details
      open={defaultOpen}
      onToggle={(e) => {
        if (e.currentTarget.open) setVisited(true);
      }}
      style={groupStyle}
    >
      <summary style={groupSummary}>
        <span style={{ fontWeight: 600 }}>Full expanded equation</span>
        <span style={{ marginLeft: 8, ...mutedNote, fontWeight: 400 }}>
          log RR as an explicit sum of {model.termCount} term{model.termCount === 1 ? '' : 's'}
        </span>
      </summary>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        {(defaultOpen || visited) && <Katex tex={model.expandedLatex} displayMode />}
      </div>
    </details>
  );
}

// ---- SNP panel -------------------------------------------------------------

interface SnpRow {
  name: string;
  or: number;
  freq: number;
}

function SnpPanel({ slot }: { slot: FileSlot }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SnpRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = fileKey(slot);

  // A new SNP file invalidates any previously parsed rows.
  useEffect(() => {
    setRows(null);
    setError(null);
  }, [key]);

  // Parse lazily, only once the panel is first opened.
  useEffect(() => {
    if (!open || rows || error) return;
    let cancelled = false;
    void (async () => {
      const { rows: parsed } = await readDelimited(await slotToFile(slot));
      if (cancelled) return;
      setRows(
        parsed.map((r) => ({
          name: r.snp_name ?? '',
          or: Number(r.snp_odds_ratio),
          freq: Number(r.snp_freq),
        })),
      );
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const count = slot.parse?.nRows ?? rows?.length ?? 0;

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} style={groupStyle}>
      <summary style={groupSummary}>
        <span style={{ fontWeight: 600 }}>Genetic variants</span>
        <span style={{ marginLeft: 8, ...mutedNote, fontWeight: 400 }}>
          {count ? `${count} SNPs` : 'SNPs'} · additive on the log-odds scale
        </span>
      </summary>
      <div style={{ marginTop: 8 }}>
        <Katex
          tex="\eta_{\text{SNP}} = \sum_{k} \log(\mathrm{OR}_k)\, g_k, \quad g_k \in \{0, 1, 2\}"
          displayMode
        />
        <p style={{ ...mutedNote, margin: '6px 0' }}>
          Each SNP contributes additively on the log scale, where gₖ is the risk-allele dosage (0/1/2).
          Odds ratios are shown as supplied and as log(OR) to match the covariate β scale.
        </p>
        {error && <ErrorBox errors={[error]} />}
        {rows && <SnpTable rows={rows} />}
        {!rows && !error && <Placeholder>Loading SNPs…</Placeholder>}
      </div>
    </details>
  );
}

function SnpTable({ rows }: { rows: SnpRow[] }) {
  const thSticky: React.CSSProperties = { ...thLeft, position: 'sticky', top: 0, background: 'var(--app-surface-2)' };
  const thStickyR: React.CSSProperties = { ...thSticky, textAlign: 'right' };
  return (
    <div
      style={{
        maxHeight: 320,
        overflow: 'auto',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--app-radius)',
      }}
    >
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thSticky}>SNP</th>
            <th style={thStickyR}>OR</th>
            <th style={thStickyR}>log(OR)</th>
            <th style={thStickyR}>Frequency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={tdLeft}>{r.name}</td>
              <td style={tdNum}>{formatNumber(r.or)}</td>
              <td style={tdNum}>{formatNumber(Math.log(r.or))}</td>
              <td style={tdNum}>{formatNumber(r.freq)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- small shared bits -----------------------------------------------------

function Placeholder({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, color: 'var(--app-muted)' }}>{children}</p>;
}

function ErrorBox({ errors }: { errors: string[] }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--app-danger)' }}>
      {errors.map((e, i) => (
        <div key={i}>⚠ {e}</div>
      ))}
    </div>
  );
}

function WarnLine({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '4px 0 0', ...mutedNote }}>⚠ {children}</p>;
}
