import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ingestByKind, type SlotKind } from './csvIngest';

// Integration coverage over the bundled iCARE-Lit (ge50) fixtures that the one-click example loader
// ships (public/examples/icare-lit/). This pins the exact preview numbers the InputSummaryPanel is
// expected to show, and guards against a fixture or validator drifting.

const dir = fileURLToPath(new URL('../../public/examples/icare-lit/', import.meta.url));

async function ingestFixture(name: string, kind: SlotKind) {
  const buf = await readFile(dir + name);
  const file = new File([buf], name);
  return ingestByKind(kind, file);
}

describe('iCARE-Lit ge50 example fixtures', () => {
  it('study data: 5000 rows, valid, not nested case-control', async () => {
    const m = await ingestFixture('icare_lit_validation_study.csv', 'study');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(5000);
    expect(m.headers).toContain('observed_outcome');
    expect(m.badges).toBeUndefined();
  });

  it('covariate profile: 5000 rows, valid', async () => {
    const m = await ingestFixture('icare_lit_validation_covariates.csv', 'covariate');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(5000);
  });

  it('reference dataset: 14090 rows, valid', async () => {
    const m = await ingestFixture('reference_covariate_data_ge50.csv', 'reference');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(14090);
  });

  it('disease + competing incidence rates parse as age,rate', async () => {
    const disease = await ingestFixture('age_specific_breast_cancer_incidence_rates.csv', 'rates');
    const competing = await ingestFixture('age_specific_all_cause_mortality_rates.csv', 'rates');
    expect(disease.errors).toEqual([]);
    expect(competing.errors).toEqual([]);
    expect(disease.headers).toEqual(['age', 'rate']);
  });

  it('formula parses to a non-empty Patsy string', async () => {
    const m = await ingestFixture('model_formula_ge50.txt', 'formula');
    expect(m.errors).toEqual([]);
    expect(m.preview).toMatch(/C\(/);
  });

  it('log-odds-ratios JSON has 37 numeric coefficients', async () => {
    const m = await ingestFixture('model_log_odds_ratios_ge50.json', 'logOddsRatios');
    expect(m.errors).toEqual([]);
    expect(m.nRows).toBe(37);
    expect(m.preview).toBe('37 coefficients');
  });
});
