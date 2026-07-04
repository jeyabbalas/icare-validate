import { buildValidateOptions } from '../lib/buildValidateOptions';
import { useAppStore } from '../state/appStore';
import { useBinSettingsStore } from '../state/binSettingsStore';
import { selectIsReadyToRun, useInputStore } from '../state/inputStore';
import { useRebinStore } from '../state/rebinStore';
import { useResultsStore } from '../state/resultsStore';
import { validate } from './icareService';
import { normalizeValidationResult } from './resultNormalizer';

// Phase 4 run controller. Snapshots the input + bin-settings stores, builds the SDK options, runs one
// validation, normalizes the result into the results store, and drives the stepper. Kept out of React so
// it is trivially testable (mock `icareService.validate`) and callable from any trigger.

/** Build options, run validation, normalize into the store, and advance the stepper. No-op if not ready. */
export async function runValidation(): Promise<void> {
  // Re-entrancy guard: a validation is multi-second, so ignore overlapping triggers (double-click, etc.).
  if (useResultsStore.getState().status === 'running') return;

  const input = useInputStore.getState();
  if (!selectIsReadyToRun(input)) return; // defense-in-depth; the Run button is also disabled
  const binSettings = useBinSettingsStore.getState();

  // Clear any prior result up front so the Results view never shows stale data alongside a live run.
  useResultsStore.setState({ result: null, normalized: null, status: 'running', error: null });
  useAppStore.getState().setStep('validate');

  try {
    // Build inside the try so a builder error surfaces the same way an engine error does.
    const result = await validate(buildValidateOptions(input, binSettings));
    const normalized = normalizeValidationResult(result);
    useResultsStore.setState({ result, normalized, status: 'done', error: null });
    // Seed the results-step re-binning from what the SDK actually binned, so the calibration view opens
    // reproducing the frozen result and "Reset to default" returns here — immune to later input edits.
    useRebinStore.getState().initFromRun({
      numberOfPercentiles: binSettings.numberOfPercentiles,
      linearPredictorCutoffs: input.linearPredictorCutoffs ?? null,
    });
    useAppStore.getState().setStep('results');
  } catch (err) {
    // `validate` already maps SDK errors to friendly text; the normalizer's guard is user-readable too.
    const message = err instanceof Error ? err.message : String(err);
    useResultsStore.setState({ status: 'error', error: message });
    // Stay on the 'validate' step so the error surfaces there with a "Back to input" affordance.
  }
}
