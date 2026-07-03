import { ingestByKind, type SlotKind } from './csvIngest';
import type { FileSlot, ModelFileKey, RiskIntervalConfig } from '../state/inputStore';

// One-click example loading. We fetch each bundled fixture into a real `File` (Blob) — rather than
// leaving it as a `{url}` slot — so example inputs flow through the exact same ingest/validation/
// preview path as a user upload. The files live under `public/examples/`; the fetch is base-relative
// (GitHub Pages sub-path safe) and served from the PWA cache when offline.
//
// This module imports only *types* from the store (erased at build time), so there is no runtime
// import cycle: the store's `loadExample` action merges the returned slots into its own state. Adding
// a new example is a matter of adding a manifest to MANIFESTS below — no new code paths.

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
  /** Mode-A models that use SNPs + family history (e.g. BPC3) name the family-history column here. */
  modelFamilyHistoryVariableName?: string;
}

export interface LoadedExample {
  study: FileSlot;
  /** Only the model files this example uses; the store fills the rest with empty slots. */
  modelFiles: Partial<Record<ModelFileKey, FileSlot>>;
  config: ExampleConfig;
}

export type ExampleId = 'icare-lit-ge50' | 'icare-lit-lt50' | 'bpc3';

interface ExampleManifest {
  dir: string;
  study: ExampleFileSpec;
  modelFiles: Partial<Record<ModelFileKey, ExampleFileSpec>>;
  config: ExampleConfig;
}

// ---- iCARE-Lit (cohort) — study/rates/covariates are shared by the lt50 & ge50 sub-models --------
const ICARE_LIT_DIR = `${BASE}examples/icare-lit/`;
const IL_STUDY: ExampleFileSpec = { filename: 'icare_lit_validation_study.csv', kind: 'study' };
const IL_DISEASE: ExampleFileSpec = {
  filename: 'age_specific_breast_cancer_incidence_rates.csv',
  kind: 'rates',
};
const IL_COMPETING: ExampleFileSpec = {
  filename: 'age_specific_all_cause_mortality_rates.csv',
  kind: 'rates',
};
const IL_COVPROFILE: ExampleFileSpec = {
  filename: 'icare_lit_validation_covariates.csv',
  kind: 'covariate',
};

const BPC3_DIR = `${BASE}examples/bpc3/`;

const MANIFESTS: Record<ExampleId, ExampleManifest> = {
  'icare-lit-ge50': {
    dir: ICARE_LIT_DIR,
    study: IL_STUDY,
    modelFiles: {
      modelDiseaseIncidenceRates: IL_DISEASE,
      modelCompetingIncidenceRates: IL_COMPETING,
      modelCovariateFormula: { filename: 'model_formula_ge50.txt', kind: 'formula' },
      modelLogRelativeRisk: { filename: 'model_log_odds_ratios_ge50.json', kind: 'logOddsRatios' },
      modelReferenceDataset: { filename: 'reference_covariate_data_ge50.csv', kind: 'reference' },
      applyCovariateProfile: IL_COVPROFILE,
    },
    config: {
      riskInterval: { kind: 'total-followup' },
      datasetName: 'iCARE-Lit validation (ge50)',
      modelName: 'iCARE-Lit ge50',
      numberOfPercentiles: 10,
      seed: 50,
    },
  },
  'icare-lit-lt50': {
    dir: ICARE_LIT_DIR,
    study: IL_STUDY,
    modelFiles: {
      modelDiseaseIncidenceRates: IL_DISEASE,
      modelCompetingIncidenceRates: IL_COMPETING,
      modelCovariateFormula: { filename: 'model_formula_lt50.txt', kind: 'formula' },
      modelLogRelativeRisk: { filename: 'model_log_odds_ratios_lt50.json', kind: 'logOddsRatios' },
      modelReferenceDataset: { filename: 'reference_covariate_data_lt50.csv', kind: 'reference' },
      applyCovariateProfile: IL_COVPROFILE,
    },
    config: {
      riskInterval: { kind: 'total-followup' },
      datasetName: 'iCARE-Lit validation (lt50)',
      modelName: 'iCARE-Lit lt50',
      numberOfPercentiles: 10,
      seed: 50,
    },
  },
  bpc3: {
    dir: BPC3_DIR,
    study: { filename: 'validation_nested_case_control_data.csv', kind: 'study' },
    modelFiles: {
      modelDiseaseIncidenceRates: {
        filename: 'age_specific_breast_cancer_incidence_rates.csv',
        kind: 'rates',
      },
      modelCompetingIncidenceRates: {
        filename: 'age_specific_all_cause_mortality_rates.csv',
        kind: 'rates',
      },
      modelCovariateFormula: { filename: 'breast_cancer_covariate_model_formula.txt', kind: 'formula' },
      modelLogRelativeRisk: {
        filename: 'breast_cancer_model_log_odds_ratios.json',
        kind: 'logOddsRatios',
      },
      modelReferenceDataset: { filename: 'reference_covariate_data.csv', kind: 'reference' },
      applyCovariateProfile: {
        filename: 'validation_nested_case_control_covariate_data.csv',
        kind: 'covariate',
      },
      modelSnpInfo: { filename: 'breast_cancer_72_snps_info.csv', kind: 'snpInfo' },
      applySnpProfile: { filename: 'validation_nested_case_control_snp_data.csv', kind: 'covariate' },
    },
    config: {
      riskInterval: { kind: 'total-followup' },
      datasetName: 'BPC3 validation (nested case-control)',
      modelName: 'BPC3 breast cancer (covariates + 72 SNPs)',
      numberOfPercentiles: 10,
      seed: 50,
      modelFamilyHistoryVariableName: 'family_history',
    },
  },
};

export const EXAMPLE_IDS = Object.keys(MANIFESTS) as ExampleId[];

export const EXAMPLE_LABELS: Record<ExampleId, string> = {
  'icare-lit-ge50': 'iCARE-Lit (ge50)',
  'icare-lit-lt50': 'iCARE-Lit (lt50)',
  bpc3: 'BPC3 (nested c-c)',
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

/** Load an example by id: fetch every fixture, validate it, and return populated slots + config. */
export async function loadExample(id: ExampleId): Promise<LoadedExample> {
  const manifest = MANIFESTS[id];
  const entries = Object.entries(manifest.modelFiles) as [ModelFileKey, ExampleFileSpec][];
  const [study, ...loaded] = await Promise.all([
    loadSlot(manifest.dir, manifest.study),
    ...entries.map(([, spec]) => loadSlot(manifest.dir, spec)),
  ]);

  const modelFiles: Partial<Record<ModelFileKey, FileSlot>> = {};
  entries.forEach(([key], i) => {
    modelFiles[key] = loaded[i];
  });

  return { study, modelFiles, config: manifest.config };
}
