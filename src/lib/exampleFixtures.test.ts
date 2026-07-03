import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ingestByKind, type SlotKind } from './csvIngest';
import {
  useInputStore,
  selectValidationSummary,
  type FileSlot,
  type ModelFileKey,
} from '../state/inputStore';

// Integration coverage over the bundled example fixtures (public/examples/…) that the one-click
// loaders ship. Pins the exact preview numbers the InputSummaryPanel is expected to show and guards
// against a fixture or validator drifting. The BPC3 case additionally assembles the full store state
// and asserts the cross-file checks pass (ready, no spurious warnings).

const iCareLitDir = fileURLToPath(new URL('../../public/examples/icare-lit/', import.meta.url));
const bpc3Dir = fileURLToPath(new URL('../../public/examples/bpc3/', import.meta.url));

async function ingestFixture(dir: string, name: string, kind: SlotKind) {
  const buf = await readFile(dir + name);
  const file = new File([buf], name);
  return ingestByKind(kind, file);
}

async function fixtureSlot(dir: string, name: string, kind: SlotKind): Promise<FileSlot> {
  const buf = await readFile(dir + name);
  const file = new File([buf], name);
  const parse = await ingestByKind(kind, file);
  return { file, url: null, source: 'example', filename: name, size: buf.length, parse };
}

describe('iCARE-Lit ge50 example fixtures', () => {
  it('study data: 5000 rows, valid, not nested case-control', async () => {
    const m = await ingestFixture(iCareLitDir, 'icare_lit_validation_study.csv', 'study');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(5000);
    expect(m.headers).toContain('observed_outcome');
    expect(m.badges).toBeUndefined();
  });

  it('covariate profile: 5000 rows, valid', async () => {
    const m = await ingestFixture(iCareLitDir, 'icare_lit_validation_covariates.csv', 'covariate');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(5000);
  });

  it('reference dataset: 14090 rows, valid', async () => {
    const m = await ingestFixture(iCareLitDir, 'reference_covariate_data_ge50.csv', 'reference');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(14090);
  });

  it('disease + competing incidence rates parse as age,rate', async () => {
    const disease = await ingestFixture(
      iCareLitDir,
      'age_specific_breast_cancer_incidence_rates.csv',
      'rates',
    );
    const competing = await ingestFixture(
      iCareLitDir,
      'age_specific_all_cause_mortality_rates.csv',
      'rates',
    );
    expect(disease.errors).toEqual([]);
    expect(competing.errors).toEqual([]);
    expect(disease.headers).toEqual(['age', 'rate']);
  });

  it('formula parses to a non-empty Patsy string', async () => {
    const m = await ingestFixture(iCareLitDir, 'model_formula_ge50.txt', 'formula');
    expect(m.errors).toEqual([]);
    expect(m.preview).toMatch(/C\(/);
  });

  it('log-odds-ratios JSON has 37 numeric coefficients', async () => {
    const m = await ingestFixture(iCareLitDir, 'model_log_odds_ratios_ge50.json', 'logOddsRatios');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(37);
    expect(m.preview).toBe('37 coefficients');
  });
});

describe('iCARE-Lit lt50 example fixtures', () => {
  it('reference dataset: 15210 rows, valid', async () => {
    const m = await ingestFixture(iCareLitDir, 'reference_covariate_data_lt50.csv', 'reference');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(15210);
  });

  it('formula + log-odds-ratios parse (26 coefficients)', async () => {
    const formula = await ingestFixture(iCareLitDir, 'model_formula_lt50.txt', 'formula');
    const lor = await ingestFixture(iCareLitDir, 'model_log_odds_ratios_lt50.json', 'logOddsRatios');
    expect(formula.errors).toEqual([]);
    expect(formula.preview).toMatch(/C\(/);
    expect(lor.errors).toEqual([]);
    expect(lor.nRows).toBe(26);
  });
});

describe('BPC3 example fixtures', () => {
  it('study data: 5285 rows, nested case-control (sampling_weights)', async () => {
    const m = await ingestFixture(bpc3Dir, 'validation_nested_case_control_data.csv', 'study');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(5285);
    expect(m.badges).toEqual(['ncc']);
  });

  it('covariate + SNP profiles match the study row count (5285)', async () => {
    const cov = await ingestFixture(
      bpc3Dir,
      'validation_nested_case_control_covariate_data.csv',
      'covariate',
    );
    const snp = await ingestFixture(bpc3Dir, 'validation_nested_case_control_snp_data.csv', 'covariate');
    expect(cov.nRows).toBe(5285);
    expect(snp.nRows).toBe(5285);
  });

  it('SNP info has the three required columns (72 SNPs)', async () => {
    const m = await ingestFixture(bpc3Dir, 'breast_cancer_72_snps_info.csv', 'snpInfo');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(72);
    expect(m.headers).toEqual(['snp_name', 'snp_odds_ratio', 'snp_freq']);
  });

  it('log-odds-ratios JSON has 77 numeric coefficients', async () => {
    const m = await ingestFixture(bpc3Dir, 'breast_cancer_model_log_odds_ratios.json', 'logOddsRatios');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(77);
  });

  it('assembles into a store state that is ready with no cross-file warnings', async () => {
    const store = useInputStore.getState();
    store.reset();
    store.setMode('A');
    store.setStudy(await fixtureSlot(bpc3Dir, 'validation_nested_case_control_data.csv', 'study'));
    const model: [ModelFileKey, string, SlotKind][] = [
      ['modelDiseaseIncidenceRates', 'age_specific_breast_cancer_incidence_rates.csv', 'rates'],
      ['modelCompetingIncidenceRates', 'age_specific_all_cause_mortality_rates.csv', 'rates'],
      ['modelCovariateFormula', 'breast_cancer_covariate_model_formula.txt', 'formula'],
      ['modelLogRelativeRisk', 'breast_cancer_model_log_odds_ratios.json', 'logOddsRatios'],
      ['modelReferenceDataset', 'reference_covariate_data.csv', 'reference'],
      ['applyCovariateProfile', 'validation_nested_case_control_covariate_data.csv', 'covariate'],
      ['modelSnpInfo', 'breast_cancer_72_snps_info.csv', 'snpInfo'],
      ['applySnpProfile', 'validation_nested_case_control_snp_data.csv', 'covariate'],
    ];
    for (const [key, name, kind] of model) {
      store.setModelFile(key, await fixtureSlot(bpc3Dir, name, kind));
    }
    store.setConfig({ modelFamilyHistoryVariableName: 'family_history' });

    const summary = selectValidationSummary(useInputStore.getState());
    expect(summary.isNcc).toBe(true);
    expect(summary.ready).toBe(true);
    // No age-coverage, row-parity, or missing-column warnings should fire on a healthy example.
    const crossWarnings = summary.items
      .flatMap((it) => it.warnings)
      .filter((w) => /does not cover|but the study has|was not found/.test(w));
    expect(crossWarnings).toEqual([]);

    store.reset();
  });
});
