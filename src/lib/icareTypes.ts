// Single source of truth for iCARE SDK types + runtime constants used across the app.
// All names below are re-exported by `wasm-icare` (see node_modules/wasm-icare/dist/index.browser.d.ts).

export type {
  // Engine handle + load options
  ICARE,
  LoadICAREOptions,
  // Validation options
  ValidateAbsoluteRiskModelOptions,
  ComputeAbsoluteRiskOptions,
  IcareModelParameters,
  // Validation result tree
  ValidationResult,
  ValidationInfo,
  AucMetric,
  BrierScoreMetric,
  ExpectedByObservedRatio,
  GoodnessOfFitTest,
  Calibration,
  ValidationReference,
  // Tabular I/O
  ColumnarTableResult,
  ColumnarTable,
  CategoricalColumn,
  TabularInput,
  UrlInput,
  PathInput,
  RowTable,
  ArrowTable,
  // Scalar / union inputs
  PredictedRiskInterval,
  AgeSpec,
  FormulaInput,
  LogOddsRatiosInput,
} from 'wasm-icare';

export { PYICARE_WHEEL_FILENAME, PYICARE_WHEEL_PATH, PYODIDE_VERSION } from 'wasm-icare';
