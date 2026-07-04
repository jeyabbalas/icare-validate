import type { CalibrationBin } from '../../math/calibrationMath';
import { formatNumber, formatPercent } from '../../lib/format';

// The neat, dedicated presentation of the per-bin calibration statistics that accompanies the calibration
// scatter (the same numbers the chart's hover tooltips carry, laid out for scanning). Fed directly by the
// Phase-5 recompute engine's `bins`, so it re-bins for free in Phase 12. Generic over the risk scale so the
// relative-risk plot (Phase 9) reuses it with `scale="relative"`. Degenerate / undefined cells render as an
// em-dash rather than a misleading zero.

const EM_DASH = '—';

type Scale = 'absolute' | 'relative';
/** The scale the bins were formed on — sets the units of the group's boundary bracket. */
type BoundaryUnit = 'lp' | 'percent';

interface Column {
  header: string;
  align: 'left' | 'right';
  render: (bin: CalibrationBin) => React.ReactNode;
}

const wrap: React.CSSProperties = { overflowX: 'auto', margin: '12px 0 0' };
const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};
const th: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--app-border)',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--app-muted)',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--app-surface-2)',
  color: 'var(--app-fg)',
  whiteSpace: 'nowrap',
};
const tableCaption: React.CSSProperties = {
  captionSide: 'top',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--app-fg)',
  padding: '0 0 6px',
};
const note: React.CSSProperties = { fontSize: 12, color: 'var(--app-muted)', margin: '6px 0 0' };

/** A value with an optional muted `(lo–hi)` confidence interval beside it. */
function ValueCi({ value, ci }: { value: string; ci?: string }) {
  return (
    <>
      {value}
      {ci && (
        <span style={{ color: 'var(--app-muted)', marginLeft: 4, fontSize: 11 }}>({ci})</span>
      )}
    </>
  );
}

/** `lo–hi` from two numbers, or undefined when either bound is non-finite (so no CI is drawn). */
function ciText(lo: number, hi: number, digits: number, scale: number): string | undefined {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  return `${formatNumber(lo * scale, digits)}–${formatNumber(hi * scale, digits)}`;
}

function eoCell(bin: CalibrationBin): React.ReactNode {
  if (!Number.isFinite(bin.expectedByObservedRatio)) return EM_DASH;
  return (
    <ValueCi
      value={formatNumber(bin.expectedByObservedRatio, 2)}
      ci={ciText(bin.lowerCiExpectedByObservedRatio, bin.upperCiExpectedByObservedRatio, 2, 1)}
    />
  );
}

/**
 * The group's boundary interval in the units it was binned on: the raw risk-score (linear-predictor)
 * bracket `bin.label` on the LP scale, or a predicted-risk percentage interval on the absolute-risk
 * scale (where `bin.lo`/`bin.hi` are proportions — `bin.label` is raw and would read as "(0.01, 0.03]").
 */
function boundaryText(bin: CalibrationBin, unit: BoundaryUnit): string {
  return unit === 'percent' ? `${formatPercent(bin.lo)}–${formatPercent(bin.hi)}` : bin.label;
}

/** The group number, optionally with its boundary interval beside it, muted, on a single line. */
function groupCell(bin: CalibrationBin, boundary: string | null): React.ReactNode {
  return (
    <>
      {bin.index + 1}
      {boundary && (
        <span style={{ color: 'var(--app-muted)', fontSize: 12, fontWeight: 400, marginLeft: 6 }}>
          {boundary}
        </span>
      )}
    </>
  );
}

function absoluteColumns(boundaryUnit: BoundaryUnit): Column[] {
  // Absolute risk isn't monotonic in the linear predictor, so LP-quantile boundaries aren't clean
  // absolute-risk bands — show the bracket only when the bins ARE absolute-risk (%) intervals.
  const boundary = (b: CalibrationBin) =>
    boundaryUnit === 'percent' ? boundaryText(b, boundaryUnit) : null;
  return [
    { header: 'Group', align: 'left', render: (b) => groupCell(b, boundary(b)) },
    { header: 'N', align: 'right', render: (b) => b.n.toLocaleString('en-US') },
    {
      header: 'Predicted',
      align: 'right',
      render: (b) => formatPercent(b.predictedAbsoluteRisk),
    },
    {
      header: 'Observed (95% CI)',
      align: 'right',
      render: (b) =>
        Number.isFinite(b.observedAbsoluteRisk) ? (
          <ValueCi
            value={formatPercent(b.observedAbsoluteRisk)}
            // Lower Wald bound clamped to 0 — a risk can't be negative.
            ci={ciText(Math.max(b.lowerCiAbsoluteRisk, 0), b.upperCiAbsoluteRisk, 2, 100)}
          />
        ) : (
          EM_DASH
        ),
    },
    { header: 'E/O (95% CI)', align: 'right', render: eoCell },
  ];
}

function relativeColumns(boundaryUnit: BoundaryUnit): Column[] {
  // Relative risk is monotonic in the linear predictor, so the boundary bracket always reads cleanly.
  return [
    { header: 'Group', align: 'left', render: (b) => groupCell(b, boundaryText(b, boundaryUnit)) },
    { header: 'N', align: 'right', render: (b) => b.n.toLocaleString('en-US') },
    {
      header: 'Predicted RR',
      align: 'right',
      render: (b) => formatNumber(b.predictedRelativeRisk, 2),
    },
    {
      header: 'Observed RR (95% CI)',
      align: 'right',
      render: (b) =>
        Number.isFinite(b.observedRelativeRisk) ? (
          <ValueCi
            value={formatNumber(b.observedRelativeRisk, 2)}
            ci={ciText(b.lowerCiRelativeRisk, b.upperCiRelativeRisk, 2, 1)}
          />
        ) : (
          EM_DASH
        ),
    },
    { header: 'E/O (95% CI)', align: 'right', render: eoCell },
  ];
}

export interface CalibrationBinTableProps {
  bins: CalibrationBin[];
  scale: Scale;
  /** Nested case-control: risks are inverse-probability-weighted (noted below the table). */
  isNcc?: boolean;
  /**
   * The scale the bins were formed on (orthogonal to `scale`, which picks the risk columns). Sets the
   * boundary bracket's units: raw linear predictor (`'lp'`, default) or predicted-risk percent.
   */
  boundaryUnit?: BoundaryUnit;
}

export function CalibrationBinTable({
  bins,
  scale,
  isNcc = false,
  boundaryUnit = 'lp',
}: CalibrationBinTableProps) {
  const columns = scale === 'absolute' ? absoluteColumns(boundaryUnit) : relativeColumns(boundaryUnit);
  const caption =
    scale === 'absolute' ? 'Per-bin absolute-risk calibration' : 'Per-bin relative-risk calibration';
  // The boundary bracket shows on the relative table always, and on the absolute table only when the
  // bins are absolute-risk (%) intervals.
  const showBracket = scale === 'relative' || boundaryUnit === 'percent';
  const bracketDesc =
    boundaryUnit === 'percent'
      ? ' The bracket is each group’s predicted absolute-risk (%) interval.'
      : ' The bracket is each group’s risk-score (linear-predictor) interval.';

  return (
    <div style={wrap}>
      <table style={table}>
        <caption style={tableCaption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" style={{ ...th, textAlign: c.align }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bins.map((bin) => (
            <tr key={bin.index}>
              {columns.map((c) => (
                <td key={c.header} style={{ ...td, textAlign: c.align }}>
                  {c.render(bin)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={note}>
        Groups run from the lowest to the highest predicted risk.
        {showBracket && bracketDesc}
        {isNcc && ' Observed risks and intervals are inverse-probability-weighted (nested case-control).'}
      </p>
    </div>
  );
}
