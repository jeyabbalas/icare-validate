import { ingestByKind, type SlotKind } from './csvIngest';
import type { FileSlot, ModelFileKey, RiskIntervalConfig } from '../state/inputStore';

// One-click example loading. We fetch each bundled fixture into a real `File` (Blob) — rather than
// leaving it as a `{url}` slot — so example inputs flow through the exact same ingest/validation/
// preview path as a user upload. The files live under `public/examples/`; the fetch is base-relative
// (GitHub Pages sub-path safe) and served from the PWA cache when offline.
//
// This module imports only *types* from the store (erased at build time), so there is no runtime
// import cycle: the store's `loadExample` action merges the returned slots into its own state.
// Adding iCARE-Lit lt50 or BPC3 later is a matter of adding a manifest here — no new code paths.

const BASE = import.meta.env.BASE_URL;

interface ExampleFileSpec {
  filename: string;
  kind: SlotKind;
}

export interface ExampleConfig {
  riskInterval: RiskIntervalConfig;
  datasetName: string;
  modelName: string;
  numberOfPercentiles: number;
  seed: number;
}

export interface LoadedExample {
  study: FileSlot;
  /** Only the model files this example uses; the store fills the rest with empty slots. */
  modelFiles: Partial<Record<ModelFileKey, FileSlot>>;
  config: ExampleConfig;
}

// iCARE-Lit (ge50) cohort example — files under public/examples/icare-lit/.
const GE50_DIR = `${BASE}examples/icare-lit/`;

const GE50_STUDY: ExampleFileSpec = { filename: 'icare_lit_validation_study.csv', kind: 'study' };

const GE50_MODEL_FILES: Partial<Record<ModelFileKey, ExampleFileSpec>> = {
  modelDiseaseIncidenceRates: {
    filename: 'age_specific_breast_cancer_incidence_rates.csv',
    kind: 'rates',
  },
  modelCompetingIncidenceRates: {
    filename: 'age_specific_all_cause_mortality_rates.csv',
    kind: 'rates',
  },
  modelCovariateFormula: { filename: 'model_formula_ge50.txt', kind: 'formula' },
  modelLogRelativeRisk: { filename: 'model_log_odds_ratios_ge50.json', kind: 'logOddsRatios' },
  modelReferenceDataset: { filename: 'reference_covariate_data_ge50.csv', kind: 'reference' },
  applyCovariateProfile: { filename: 'icare_lit_validation_covariates.csv', kind: 'covariate' },
};

const GE50_CONFIG: ExampleConfig = {
  riskInterval: { kind: 'total-followup' },
  datasetName: 'iCARE-Lit validation (ge50)',
  modelName: 'iCARE-Lit ge50',
  numberOfPercentiles: 10,
  seed: 50,
};

/** Fetch a bundled file into a `File`, preserving the original filename. Throws on a bad response. */
async function fetchAsFile(dir: string, filename: string): Promise<File> {
  const res = await fetch(`${dir}${filename}`);
  if (!res.ok) throw new Error(`Failed to fetch ${filename} (${res.status})`);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

/** Fetch a file, wrap it as an `example` slot, and attach validation metadata. */
async function loadSlot(dir: string, spec: ExampleFileSpec): Promise<FileSlot> {
  const file = await fetchAsFile(dir, spec.filename);
  const parse = await ingestByKind(spec.kind, file);
  return { file, url: null, source: 'example', filename: file.name, size: file.size, parse };
}

/** Load the iCARE-Lit (ge50) example: fetch every fixture, validate it, and return populated slots. */
export async function loadIcareLitGe50(): Promise<LoadedExample> {
  const entries = Object.entries(GE50_MODEL_FILES) as [ModelFileKey, ExampleFileSpec][];
  const [study, ...loaded] = await Promise.all([
    loadSlot(GE50_DIR, GE50_STUDY),
    ...entries.map(([, spec]) => loadSlot(GE50_DIR, spec)),
  ]);

  const modelFiles: Partial<Record<ModelFileKey, FileSlot>> = {};
  entries.forEach(([key], i) => {
    modelFiles[key] = loaded[i];
  });

  return { study, modelFiles, config: GE50_CONFIG };
}
