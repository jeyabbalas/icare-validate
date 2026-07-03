import { useInputStore } from '../../state/inputStore';
import { AgeSpecField } from './fields';
import { NumericVectorUpload } from './NumericVectorUpload';

const noteStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--app-muted)',
  marginTop: 0,
  marginBottom: 10,
};

/**
 * Optional reference-population inputs that enable the `reference` block of the result (a reference
 * calibration curve). The two modes take different inputs, matching py-icare:
 *   • Mode A supplies reference entry/exit ages; the model computes reference risks from the
 *     reference dataset.
 *   • Mode B supplies precomputed reference predicted-risk / linear-predictor arrays directly.
 */
export function ReferencePopulationPanel() {
  const mode = useInputStore((s) => s.mode);
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        Reference population (optional — enables the reference calibration curve)
      </summary>
      <div style={{ marginTop: 10 }}>{mode === 'A' ? <ModeARefs /> : <ModeBRefs />}</div>
    </details>
  );
}

function ModeARefs() {
  const referenceEntryAge = useInputStore((s) => s.referenceEntryAge);
  const referenceExitAge = useInputStore((s) => s.referenceExitAge);
  const setConfig = useInputStore((s) => s.setConfig);
  return (
    <div>
      <p style={noteStyle}>
        Provide the reference cohort’s age window. iCARE computes reference risks from the reference
        dataset over this interval. Enter a single age, or a comma-separated list (one per subject).
      </p>
      <AgeSpecField
        label="Reference entry age"
        value={referenceEntryAge}
        onChange={(v) => setConfig({ referenceEntryAge: v })}
        placeholder="e.g. 50  or  50, 52, 55"
      />
      <AgeSpecField
        label="Reference exit age"
        value={referenceExitAge}
        onChange={(v) => setConfig({ referenceExitAge: v })}
        placeholder="e.g. 55  or  55, 57, 60"
      />
    </div>
  );
}

function ModeBRefs() {
  const predicted = useInputStore((s) => s.referencePredictedRisks);
  const linear = useInputStore((s) => s.referenceLinearPredictors);
  const setReferenceVector = useInputStore((s) => s.setReferenceVector);
  return (
    <div>
      <p style={noteStyle}>
        Supply the precomputed risks for a reference cohort (one number per reference subject) to
        draw the reference calibration curve.
      </p>
      <NumericVectorUpload
        label="Reference predicted risks"
        slot={predicted}
        onChange={(slot) => setReferenceVector('referencePredictedRisks', slot)}
        hint="A file of numbers: JSON array, one-column CSV, or whitespace-separated."
      />
      <NumericVectorUpload
        label="Reference linear predictors"
        slot={linear}
        onChange={(slot) => setReferenceVector('referenceLinearPredictors', slot)}
        hint="A file of numbers: JSON array, one-column CSV, or whitespace-separated."
      />
    </div>
  );
}
