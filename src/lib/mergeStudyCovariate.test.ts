import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { csvParse } from 'd3-dsv';
import { describe, it, expect } from 'vitest';
import { readDelimited, type ParsedTable } from './csvIngest';
import { mergeStudyCovariate } from './mergeStudyCovariate';

// The merge is the display-side mirror of how py-icare links study data and covariate profile:
// strictly by row position (never an `id` join). These tests pin that contract on the bundled example
// fixtures and on synthetic edge cases (id-order mismatch, appended columns, dropped covariate id).

const iCareLitDir = fileURLToPath(new URL('../../public/examples/icare-lit/', import.meta.url));
const bpc3Dir = fileURLToPath(new URL('../../public/examples/bpc3/', import.meta.url));

async function readFixture(dir: string, name: string): Promise<ParsedTable> {
  const buf = await readFile(dir + name);
  return readDelimited(new File([buf], name));
}

/** Build a genuine ParsedTable (rows carry d3-dsv's `.columns`) from an inline CSV string. */
function parse(csv: string): ParsedTable {
  const rows = csvParse(csv.trim());
  return { headers: rows.columns ?? [], rows };
}

describe('mergeStudyCovariate — iCARE-Lit fixtures (disjoint columns)', () => {
  it('appends all 12 covariate columns, 5000 rows, linked by row order', async () => {
    const study = await readFixture(iCareLitDir, 'icare_lit_validation_study.csv');
    const cov = await readFixture(iCareLitDir, 'icare_lit_validation_covariates.csv');
    const m = mergeStudyCovariate(study, cov);

    expect(m.rows.length).toBe(5000);
    expect(m.foldedColumns).toEqual([]);
    expect(m.appendedColumns.length).toBe(12); // 13 covariate columns minus `id`
    expect(m.appendedColumns).not.toContain('id');
    expect(m.columns.length).toBe(18); // 6 study + 12 covariate
    expect(m.idOrderMismatch).toBe(false);

    // Correct linkage: study id 1 (row 0) carries its own covariate values.
    expect(m.rows[0].id).toBe('1');
    expect(m.rows[0].study_entry_age).toBe('56');
    expect(m.rows[0].age_at_menarche).toBe('13');
  });
});

describe('mergeStudyCovariate — BPC3 fixtures (covariate ⊆ study)', () => {
  it('folds all 13 covariate columns already in the study; adds nothing; 5285 rows', async () => {
    const study = await readFixture(bpc3Dir, 'validation_nested_case_control_data.csv');
    const cov = await readFixture(bpc3Dir, 'validation_nested_case_control_covariate_data.csv');
    const m = mergeStudyCovariate(study, cov);

    expect(m.rows.length).toBe(5285);
    expect(m.appendedColumns).toEqual([]);
    expect(m.foldedColumns.length).toBe(13); // 14 covariate columns minus `id`, all present in the study
    expect(m.columns.length).toBe(91); // study columns unchanged
    expect(m.idOrderMismatch).toBe(false);
  });
});

describe('mergeStudyCovariate — synthetic edge cases', () => {
  it('flags an id-order mismatch but still merges positionally', () => {
    const study = parse('id,a\n1,x\n2,y\n3,z');
    const cov = parse('id,b\n1,p\n3,q\n2,r'); // same ids, different order
    const m = mergeStudyCovariate(study, cov);

    expect(m.idOrderMismatch).toBe(true);
    expect(m.appendedColumns).toEqual(['b']);
    // Positional (NOT an id join): study row for id 2 is index 1, paired with covariate index 1 (b=q).
    expect(m.rows[1].id).toBe('2');
    expect(m.rows[1].b).toBe('q');
  });

  it('appends genuinely new covariate columns and always drops the covariate id', () => {
    const study = parse('a\nx\ny'); // no id column in the study
    const cov = parse('id,c\n10,foo\n11,bar');
    const m = mergeStudyCovariate(study, cov);

    expect(m.columns).toEqual(['a', 'c']); // covariate `id` dropped, `c` appended
    expect(m.appendedColumns).toEqual(['c']);
    expect(m.foldedColumns).toEqual([]);
    expect(m.idOrderMismatch).toBe(false); // study has no id → no order check possible
    expect(m.rows[0]).toEqual({ a: 'x', c: 'foo' });
    expect(m.rows[1]).toEqual({ a: 'y', c: 'bar' });
  });

  it('serializes a header + one row per subject to CSV', () => {
    const study = parse('id,a\n1,x\n2,y');
    const cov = parse('id,b\n1,p\n2,q');
    const m = mergeStudyCovariate(study, cov);
    expect(m.csv.split('\n')).toEqual(['id,a,b', '1,x,p', '2,y,q']);
  });
});
