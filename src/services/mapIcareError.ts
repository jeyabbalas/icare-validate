// Pure error-message mapping for the iCARE engine. Kept in its own module (no `wasm-icare` import) so it
// is unit-testable without pulling in the SDK's worker-URL import. Maps known SDK / py-icare failure
// strings to actionable messages; unknown errors fall through to the raw text.

/** Map known SDK / py-icare error strings to friendly messages; fall back to the raw text. */
export function mapIcareError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/is not implemented yet/i.test(raw)) {
    return 'Internal build error: a non-browser iCARE build was loaded. Vite is not resolving the wasm-icare "browser" export condition.';
  }
  if (/offline browser boot requires an explicit indexURL/i.test(raw)) {
    return 'Runtime assets missing (no Pyodide indexURL). Run "npm run vendor" to populate public/pyodide, then reload.';
  }
  if (/offline browser boot requires an explicit.*pyicareWheelUrl/i.test(raw)) {
    return 'Runtime assets missing (no pyicare wheel). Run "npm run vendor" to populate public/pyodide, then reload.';
  }
  if (/ICARE engine is closed/i.test(raw)) {
    return 'The iCARE engine was closed. Reload the page to start a new session.';
  }
  if (/failed to fetch '.+':\s*\d+/i.test(raw)) {
    return `A required runtime asset could not be loaded (offline cache miss or a missing vendored file). ${raw}`;
  }
  if (/browser cannot read/i.test(raw)) {
    return 'File paths are not supported in the browser. Provide each input as a URL or an uploaded file.';
  }
  // py-icare 1.3.0 hard-codes `risk_estimates` / `linear_predictors` in its Mode-B stats, so a run with
  // differently-named precomputed columns raises a KeyError deep in the traceback. Input validation should
  // block this first; this is the safety net so the user never sees a raw Python traceback.
  if (/keyerror[\s\S]*(risk_estimates|linear_predictors)/i.test(raw)) {
    return 'Mode B requires the study’s precomputed columns to be named exactly `risk_estimates` and `linear_predictors`.';
  }

  return raw || 'Unknown error while running the iCARE engine.';
}
