import { miniToggle } from '../../viz/chartChrome';

// On/off toggle for a calibration plot's fitted-line overlay, shown as a chart toolbar extra beside the
// download buttons (and, on the relative-risk plot, the linear/log scale toggle). It mirrors the existing
// ScaleToggle idiom — a `miniToggle`-styled button with `aria-pressed` — so the two toolbar controls read
// as one set. Off by default; each plot owns its own toggle state (this is a pure view option that does not
// touch the shared re-binned `rc`).

export function FitToggle({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Linear fit overlay">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        style={miniToggle(checked)}
        title="Overlay a weighted linear fit and show its slope (1 = perfect calibration) in the legend"
      >
        Linear fit
      </button>
    </div>
  );
}
