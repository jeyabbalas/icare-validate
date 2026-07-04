import { isDefaultRebin, useRebinStore, type RebinScale, type RebinMethod } from '../../state/rebinStore';
import { miniToggle } from '../../viz/chartChrome';
import { NumberField, NumericListField } from '../input/fields';

// The full-width interactive re-binning toolbar above the two calibration scatters (Phase 12). It governs
// the shared `rc` — both plots, both per-bin tables, and the H–L / RR goodness-of-fit tiles — so it lives
// in CalibrationPanel, not in one figure's toolbarExtras. All of it re-bins client-side (no SDK re-run).
//   • Scale  — which per-subject score forms the bins: the model's risk score (linear predictor, py-icare's
//     own binning variable) or absolute risk (the clinically-intuitive extension, where cutpoints are typed
//     as PERCENT, e.g. "3" for the 3% threshold).
//   • Method — equal-count quantiles (N bins) or explicit cutpoints.
//   • Reset  — return to the run-seeded SDK bins (disabled when already there).
// Dropped out-of-range / duplicate cutpoints (from the engine) surface as an aria-live warning list.

const group: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 12,
};
const groupLabel: React.CSSProperties = { fontWeight: 600, fontSize: 13, color: 'var(--app-fg)' };

function resetButton(enabled: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--app-border)',
    borderRadius: 'var(--app-radius)',
    background: 'var(--app-surface-2)',
    color: enabled ? 'var(--app-fg)' : 'var(--app-muted)',
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.55,
  };
}

/** A labelled segmented toggle built on the shared `miniToggle` button style. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div style={group}>
      <span style={groupLabel}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }} role="group" aria-label={label}>
        {options.map(([val, text]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            aria-pressed={value === val}
            style={miniToggle(value === val)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RebinControls({ warnings }: { warnings: string[] }) {
  const scale = useRebinStore((s) => s.scale);
  const method = useRebinStore((s) => s.method);
  const numberOfPercentiles = useRebinStore((s) => s.numberOfPercentiles);
  const cutpoints = useRebinStore((s) => s.cutpoints);
  const set = useRebinStore((s) => s.set);
  const reset = useRebinStore((s) => s.reset);
  const canReset = useRebinStore((s) => !isDefaultRebin(s));

  const absRisk = scale === 'absolute-risk';

  return (
    <div>
      <div className="rebin-toolbar">
        <Segmented<RebinScale>
          label="Bin by"
          value={scale}
          options={[
            ['linear-predictor', 'Risk score'],
            ['absolute-risk', 'Absolute risk'],
          ]}
          onChange={(v) => set({ scale: v })}
        />
        <Segmented<RebinMethod>
          label="Method"
          value={method}
          options={[
            ['quantiles', 'Quantiles'],
            ['cutpoints', 'Cutpoints'],
          ]}
          onChange={(v) => set({ method: v })}
        />
        {method === 'quantiles' ? (
          <div style={{ width: 120 }}>
            <NumberField
              label="Bins"
              value={numberOfPercentiles}
              min={2}
              step={1}
              onChange={(v) => set({ numberOfPercentiles: v })}
            />
          </div>
        ) : (
          <div style={{ width: 240 }}>
            <NumericListField
              label={absRisk ? 'Cutpoints (%)' : 'Cutpoints (risk score)'}
              values={cutpoints}
              placeholder={absRisk ? 'e.g. 3, 5' : 'e.g. -1.5, 0, 1.5'}
              onChange={(v) => set({ cutpoints: v })}
            />
          </div>
        )}
        <div style={{ marginLeft: 'auto', marginBottom: 12 }}>
          <button
            type="button"
            onClick={reset}
            disabled={!canReset}
            style={resetButton(canReset)}
          >
            Reset to default
          </button>
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="rebin-warning" aria-live="polite">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
