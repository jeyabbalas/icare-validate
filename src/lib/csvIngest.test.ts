import { describe, it, expect } from 'vitest';
import {
  validateStudyData,
  validateRatesTable,
  validateReferenceDataset,
  validateCovariateProfile,
  validateSnpInfo,
  readFormula,
  readLogOddsRatios,
  readNumericVector,
} from './csvIngest';

// Node 18+/22 provides a global `File` (structurally a Blob), which is exactly what the browser
// passes to these validators — so the tests exercise the real code path.
const csvFile = (name: string, body: string) => new File([body], name, { type: 'text/csv' });
const txtFile = (name: string, body: string) => new File([body], name, { type: 'text/plain' });
const jsonFile = (name: string, body: string) =>
  new File([body], name, { type: 'application/json' });

describe('validateStudyData', () => {
  const goodStudy = [
    'id,study_entry_age,observed_followup,study_exit_age,observed_outcome,time_of_onset',
    '1,56,11,67,0,Inf',
    '2,51,6,57,1,55',
  ].join('\n');

  it('accepts a well-formed study table', async () => {
    const r = await validateStudyData(csvFile('study.csv', goodStudy));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.meta.nRows).toBe(2);
    expect(r.meta.headers).toContain('observed_outcome');
    expect(r.meta.badges).toBeUndefined();
  });

  it('errors when observed_outcome is missing', async () => {
    const body = 'id,study_entry_age,study_exit_age\n1,56,67';
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/observed_outcome/);
  });

  it('errors when observed_outcome is not binary', async () => {
    const body = ['study_entry_age,study_exit_age,observed_outcome', '56,67,0', '51,57,2'].join(
      '\n',
    );
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/must be 0 or 1/);
  });

  it('errors when an age column is non-numeric', async () => {
    const body = ['study_entry_age,study_exit_age,observed_outcome', 'fifty,67,0'].join('\n');
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/study_entry_age.*must be numeric/);
  });

  it('does not reject "Inf" in time_of_onset', async () => {
    const r = await validateStudyData(csvFile('study.csv', goodStudy));
    expect(r.errors.join(' ')).not.toMatch(/time_of_onset/);
  });

  it('errors when the mandatory time_of_onset column is missing', async () => {
    const body = ['study_entry_age,study_exit_age,observed_outcome', '56,67,0'].join('\n');
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/time_of_onset/);
  });

  it('errors when time_of_onset is empty on a row (missing value)', async () => {
    const body = [
      'study_entry_age,study_exit_age,observed_outcome,time_of_onset',
      '56,67,0,Inf',
      '51,57,1,',
    ].join('\n');
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/time_of_onset/);
  });

  it('flags nested case-control via sampling_weights', async () => {
    const body = [
      'study_entry_age,study_exit_age,observed_outcome,sampling_weights,time_of_onset',
      '56,67,0,0.1,Inf',
      '51,57,1,1,55',
    ].join('\n');
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(true);
    expect(r.meta.badges).toEqual(['ncc']);
    expect(r.warnings.join(' ')).toMatch(/nested case-control/i);
  });

  it('warns when exit age precedes entry age', async () => {
    const body = ['study_entry_age,study_exit_age,observed_outcome,time_of_onset', '67,56,0,Inf'].join(
      '\n',
    );
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/below/);
  });

  it('computes study stats: age span, case count, and per-column summaries', async () => {
    const r = await validateStudyData(csvFile('study.csv', goodStudy));
    const st = r.meta.stats;
    expect(st?.nCases).toBe(1); // one row has observed_outcome = 1
    expect(st?.ageMin).toBe(51); // min study_entry_age
    expect(st?.ageMax).toBe(67); // max study_exit_age
    expect(st?.columns?.study_entry_age.min).toBe(51);
    expect(st?.columns?.study_entry_age.max).toBe(56);
  });

  it('warns on non-positive sampling weights', async () => {
    const body = [
      'study_entry_age,study_exit_age,observed_outcome,sampling_weights,time_of_onset',
      '56,67,0,0,Inf',
      '51,57,1,1,55',
    ].join('\n');
    const r = await validateStudyData(csvFile('study.csv', body));
    expect(r.meta.badges).toEqual(['ncc']);
    expect(r.warnings.join(' ')).toMatch(/sampling_weights.*positive/i);
  });
});

describe('validateRatesTable', () => {
  it('accepts a valid age,rate table', async () => {
    const r = await validateRatesTable(csvFile('rates.csv', 'age,rate\n0,0\n1,0.0002'));
    expect(r.ok).toBe(true);
    expect(r.meta.nRows).toBe(2);
  });

  it('errors on a wrong shape (missing rate column)', async () => {
    const r = await validateRatesTable(csvFile('rates.csv', 'age\n0\n1'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/rate/);
  });

  it('errors on a negative rate', async () => {
    const r = await validateRatesTable(csvFile('rates.csv', 'age,rate\n0,-1'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/rate/);
  });

  it('records the sorted set of ages present (rateAges)', async () => {
    const r = await validateRatesTable(csvFile('rates.csv', 'age,rate\n2,0.1\n0,0.2\n1,0.3'));
    expect(r.meta.stats?.rateAges).toEqual([0, 1, 2]);
  });

  it('tolerates a blank rate (missing for an out-of-range age) but excludes it from coverage', async () => {
    const r = await validateRatesTable(csvFile('rates.csv', 'age,rate\n50,0.01\n85,\n86,'));
    expect(r.ok).toBe(true); // blank rates are not a blocking error
    expect(r.meta.stats?.rateAges).toEqual([50]); // ages 85, 86 have no rate → not covered
  });

  it('accepts a start_age,end_age,rate band table and expands coverage per year', async () => {
    const r = await validateRatesTable(
      csvFile('bands.csv', 'start_age,end_age,rate\n0,40,0.001\n40,50,0.02'),
    );
    expect(r.ok).toBe(true);
    expect(r.meta.badges).toContain('age bands');
    // Half-open [0,40) ∪ [40,50) ⇒ ages 0..49; ageMin = first start, ageMax = last (inclusive) end.
    expect(r.meta.stats?.rateAges?.length).toBe(50);
    expect(r.meta.stats?.rateAges?.[0]).toBe(0);
    expect(r.meta.stats?.rateAges?.at(-1)).toBe(49);
    expect(r.meta.stats?.ageMin).toBe(0);
    expect(r.meta.stats?.ageMax).toBe(50);
  });

  it('errors on non-integer band ages', async () => {
    const r = await validateRatesTable(csvFile('bands.csv', 'start_age,end_age,rate\n0,40.5,0.001'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/integer/);
  });

  it('errors on non-contiguous bands (a gap)', async () => {
    const r = await validateRatesTable(
      csvFile('bands.csv', 'start_age,end_age,rate\n0,40,0.001\n45,50,0.02'),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/contiguous/);
  });

  it('errors on a band rate outside [0, 1]', async () => {
    const r = await validateRatesTable(csvFile('bands.csv', 'start_age,end_age,rate\n0,40,1.5'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/rate/);
  });

  it('warns (does not block) when a per-age rate exceeds 1', async () => {
    const r = await validateRatesTable(csvFile('rates.csv', 'age,rate\n40,2'));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/exceed/);
  });
});

describe('structural validators', () => {
  it('reference dataset: accepts header + rows, no id required', async () => {
    const r = await validateReferenceDataset(csvFile('ref.csv', 'a,b\n1,2\n3,4'));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/id/);
  });

  it('reference dataset: errors when empty (header only)', async () => {
    const r = await validateReferenceDataset(csvFile('ref.csv', 'a,b'));
    expect(r.ok).toBe(false);
  });

  it('covariate profile: warns when id absent', async () => {
    const r = await validateCovariateProfile(csvFile('cov.csv', 'a,b\n1,2'));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/id/);
  });
});

describe('validateSnpInfo', () => {
  it('accepts a well-formed SNP info table', async () => {
    const body = 'snp_name,snp_odds_ratio,snp_freq\nrs1,1.2,0.3\nrs2,0.9,0.5';
    const r = await validateSnpInfo(csvFile('snps.csv', body));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('errors when a required SNP column is missing', async () => {
    const r = await validateSnpInfo(csvFile('snps.csv', 'snp_name,snp_freq\nrs1,0.3'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/snp_odds_ratio/);
  });

  it('warns (advisory) on out-of-range frequency and non-positive odds ratio', async () => {
    const body = 'snp_name,snp_odds_ratio,snp_freq\nrs1,0,1.4\nrs2,1.1,0.5';
    const r = await validateSnpInfo(csvFile('snps.csv', body));
    expect(r.ok).toBe(true); // ranges are advisory
    expect(r.warnings.join(' ')).toMatch(/snp_freq/);
    expect(r.warnings.join(' ')).toMatch(/snp_odds_ratio/);
  });
});

describe('readFormula', () => {
  it('reads a Patsy formula', async () => {
    const r = await readFormula(txtFile('f.txt', 'oc_ever + C(parity, levels=[]) '));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('oc_ever + C(parity, levels=[])');
  });

  it('errors on an empty formula', async () => {
    const r = await readFormula(txtFile('f.txt', '   '));
    expect(r.ok).toBe(false);
  });
});

describe('readLogOddsRatios', () => {
  it('parses a flat number map', async () => {
    const r = await readLogOddsRatios(jsonFile('lor.json', '{"oc_ever": 0.13, "bbd": 0.41}'));
    expect(r.ok).toBe(true);
    expect(r.map.oc_ever).toBeCloseTo(0.13);
    expect(Object.keys(r.map)).toHaveLength(2);
  });

  it('errors on invalid JSON', async () => {
    const r = await readLogOddsRatios(jsonFile('lor.json', '{not json'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Invalid JSON/);
  });

  it('errors on non-numeric coefficients', async () => {
    const r = await readLogOddsRatios(jsonFile('lor.json', '{"oc_ever": "high"}'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Non-numeric/);
  });

  it('errors on a non-object payload', async () => {
    const r = await readLogOddsRatios(jsonFile('lor.json', '[1,2,3]'));
    expect(r.ok).toBe(false);
  });
});

describe('readNumericVector', () => {
  it('parses a JSON array of numbers', async () => {
    const r = await readNumericVector(jsonFile('ref.json', '[0.1, 0.2, 0.3]'));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual([0.1, 0.2, 0.3]);
  });

  it('parses a one-column CSV, tolerating a header token', async () => {
    const r = await readNumericVector(csvFile('ref.csv', 'predicted_risk\n0.01\n0.5\n0.9'));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual([0.01, 0.5, 0.9]);
    expect(r.warnings.join(' ')).toMatch(/header token/);
  });

  it('parses whitespace/comma-separated numbers with no header', async () => {
    const r = await readNumericVector(txtFile('ref.txt', '1 2, 3\n4'));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual([1, 2, 3, 4]);
  });

  it('errors on a non-numeric value', async () => {
    const r = await readNumericVector(csvFile('ref.csv', '0.1\nfoo\n0.3'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non-numeric/i);
  });

  it('errors on an empty file', async () => {
    const r = await readNumericVector(txtFile('ref.txt', '   '));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/empty/i);
  });

  it('errors on a JSON object (not an array)', async () => {
    const r = await readNumericVector(jsonFile('ref.json', '{"a":1}'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/array/i);
  });
});
