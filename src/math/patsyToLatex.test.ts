import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  buildModel,
  escapeTextMode,
  factorToLatex,
  formatNumber,
  parseDesignKey,
  parseFactor,
  parseFormulaSpecs,
  parseLevelsList,
  prettyLevelLatex,
  splitTopLevel,
  termToLatex,
  type CoefGroup,
  type Model,
} from './patsyToLatex';

// ---- fixtures --------------------------------------------------------------

const iCareLitDir = fileURLToPath(new URL('../../public/examples/icare-lit/', import.meta.url));
const bpc3Dir = fileURLToPath(new URL('../../public/examples/bpc3/', import.meta.url));

const readJson = (path: string): Record<string, number> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
const readText = (path: string): string => readFileSync(path, 'utf8');

const lt50 = {
  map: readJson(`${iCareLitDir}model_log_odds_ratios_lt50.json`),
  formula: readText(`${iCareLitDir}model_formula_lt50.txt`),
};
const ge50 = {
  map: readJson(`${iCareLitDir}model_log_odds_ratios_ge50.json`),
  formula: readText(`${iCareLitDir}model_formula_ge50.txt`),
};
const bpc3 = {
  map: readJson(`${bpc3Dir}breast_cancer_model_log_odds_ratios.json`),
  formula: readText(`${bpc3Dir}breast_cancer_covariate_model_formula.txt`),
};

const nonRefRows = (m: Model): number =>
  m.groups.reduce((n, g) => n + g.rows.filter((r) => !r.isReference).length, 0);
const groupById = (m: Model, id: string): CoefGroup | undefined => m.groups.find((g) => g.id === id);

// ---- tokenizers ------------------------------------------------------------

describe('splitTopLevel', () => {
  it('splits an interaction on the top-level colon only', () => {
    expect(splitTopLevel("hrt_type:C(bmi, levels=['<25','25-30'])[T.25-30]", ':')).toEqual([
      'hrt_type',
      "C(bmi, levels=['<25','25-30'])[T.25-30]",
    ]);
  });
  it('does not split a colon inside brackets (levels / slices)', () => {
    expect(splitTopLevel('I(x[0:2])', ':')).toEqual(['I(x[0:2])']);
    expect(splitTopLevel('C(a, levels=[0, 1, 2])[T.1]', ':')).toEqual(['C(a, levels=[0, 1, 2])[T.1]']);
  });
  it('splits a 3-way interaction', () => {
    expect(splitTopLevel('a[T.a2]:b[T.b2]:c[T.c2]', ':')).toHaveLength(3);
  });
});

describe('parseLevelsList', () => {
  it('is whitespace-insensitive and strips quotes', () => {
    expect(parseLevelsList("'a', 'b', 'c'")).toEqual(['a', 'b', 'c']);
    expect(parseLevelsList("'a','b','c'")).toEqual(['a', 'b', 'c']);
  });
  it('handles bare integer and decimal levels', () => {
    expect(parseLevelsList('0, 1, 2')).toEqual(['0', '1', '2']);
    expect(parseLevelsList('2, 2.5')).toEqual(['2', '2.5']);
  });
  it('protects a comma inside a quoted level', () => {
    expect(parseLevelsList("'a,b', 'c'")).toEqual(['a,b', 'c']);
  });
  it('returns [] for empty input', () => {
    expect(parseLevelsList('')).toEqual([]);
  });
});

// ---- factor parsing --------------------------------------------------------

describe('parseFactor', () => {
  it('parses bare numeric / binary terms', () => {
    expect(parseFactor('oc_ever')).toMatchObject({ kind: 'numeric', name: 'oc_ever' });
    expect(parseFactor('menopause_hrt_e')).toMatchObject({ kind: 'numeric', name: 'menopause_hrt_e' });
  });
  it('parses a Treatment categorical with string levels + reference = first level', () => {
    const f = parseFactor("C(parity, levels=['0', '1', '2', '>=3'])[T.>=3]");
    expect(f).toMatchObject({ kind: 'categorical', name: 'parity', level: '>=3', reference: '0' });
    expect(f.levels).toEqual(['0', '1', '2', '>=3']);
  });
  it('parses integer-level categoricals with reference 0', () => {
    const f = parseFactor('C(menopause_hrt, levels=[0, 1, 2])[T.2]');
    expect(f).toMatchObject({ kind: 'categorical', name: 'menopause_hrt', level: '2', reference: '0' });
  });
  it('uses the formula spec as a fallback when a key omits levels (whitespace gotcha)', () => {
    const specs = parseFormulaSpecs(ge50.formula); // ge50 formula has NO spaces inside levels=[...]
    const f = parseFactor('C(hrt)[T.current]', specs);
    expect(f).toMatchObject({ kind: 'categorical', name: 'hrt', level: 'current', reference: 'never' });
  });
  it('recognizes Tier-2 constructs (contrasts, poly, spline, transforms, Q, intercept)', () => {
    expect(parseFactor('C(a, Sum)[S.a1]')).toMatchObject({ kind: 'categorical', contrast: 'sum' });
    expect(parseFactor('C(a, Poly).Linear')).toMatchObject({ kind: 'categorical', contrast: 'poly' });
    expect(parseFactor('C(a, Helmert)[H.a2]')).toMatchObject({ contrast: 'helmert' });
    expect(parseFactor('C(a, Diff)[D.a1]')).toMatchObject({ contrast: 'diff' });
    expect(parseFactor('a[a1]')).toMatchObject({ kind: 'categorical', contrast: 'fullrank', level: 'a1' });
    expect(parseFactor('bs(x, df=3)[0]')).toMatchObject({ kind: 'transform', contrast: 'spline' });
    expect(parseFactor('I(x ** 2)')).toMatchObject({ kind: 'transform' });
    expect(parseFactor('np.log(x)')).toMatchObject({ kind: 'transform' });
    expect(parseFactor("Q('w.kg')")).toMatchObject({ kind: 'numeric', name: 'w.kg' });
    expect(parseFactor('Intercept')).toMatchObject({ kind: 'intercept' });
  });
  it('never throws — pathological tokens fall back to raw', () => {
    expect(parseFactor('%%weird stuff&&')).toMatchObject({ kind: 'raw' });
  });
});

describe('parseDesignKey', () => {
  it('parses cont×cat and cat×cat interactions into 2 factors', () => {
    expect(parseDesignKey("hrt_type:C(bmi, levels=['<25','25-30'])[T.25-30]")).toHaveLength(2);
    expect(
      parseDesignKey("C(a, levels=['x','y'])[T.y]:C(b, levels=['p','q'])[T.q]"),
    ).toHaveLength(2);
  });
});

// ---- LaTeX rendering -------------------------------------------------------

describe('escapeTextMode', () => {
  it('escapes each special char once (backslash handled first)', () => {
    expect(escapeTextMode('a_b')).toBe('a\\_b');
    expect(escapeTextMode('x{y}')).toBe('x\\{y\\}');
    expect(escapeTextMode('a\\b')).toBe('a\\textbackslash{}b');
    expect(escapeTextMode('50%&$#')).toBe('50\\%\\&\\$\\#');
  });
});

describe('prettyLevelLatex', () => {
  it('renders comparators as math relations outside \\text{}', () => {
    expect(prettyLevelLatex('<=10')).toBe('{\\leq}\\text{10}');
    expect(prettyLevelLatex('>=16')).toBe('{\\geq}\\text{16}');
    expect(prettyLevelLatex('<20')).toBe('{<}\\text{20}');
  });
  it('renders numeric ranges with an en-dash', () => {
    expect(prettyLevelLatex('20-25')).toBe('\\text{20\\textendash{}25}');
    expect(prettyLevelLatex('>0-5')).toBe('{>}\\text{0\\textendash{}5}');
  });
  it('renders word levels as plain text', () => {
    expect(prettyLevelLatex('never')).toBe('\\text{never}');
  });
});

describe('factorToLatex / termToLatex', () => {
  it('renders an indicator for a Treatment level', () => {
    expect(factorToLatex(parseFactor("C(bmi_curc, levels=['<25','25-30'])[T.25-30]"))).toBe(
      '\\mathbb{1}\\{\\text{bmi\\_curc} = \\text{25\\textendash{}30}\\}',
    );
  });
  it('joins interaction factors with \\cdot', () => {
    const tex = termToLatex(parseDesignKey("hrt_type:C(bmi, levels=['<25','25-30'])[T.25-30]"));
    expect(tex).toContain('\\cdot');
    expect(tex).toContain('\\text{hrt\\_type}');
  });
});

describe('formatNumber & exp', () => {
  it('fixes to 3 dp and keeps zeros', () => {
    expect(formatNumber(0.173953307)).toBe('0.174');
    expect(formatNumber(0)).toBe('0.000');
    expect(formatNumber(-0.198450939)).toBe('-0.198');
  });
  it('maps non-finite to an em dash', () => {
    expect(formatNumber(Number.NaN)).toBe('—');
  });
});

// ---- fixture correctness ---------------------------------------------------

describe('buildModel — iCARE-Lit lt50', () => {
  const model = buildModel(lt50.map, lt50.formula);
  it('has 26 coefficients and every one lands in exactly one non-reference row', () => {
    expect(model.termCount).toBe(26);
    expect(nonRefRows(model)).toBe(26);
    expect(model.hasInteractions).toBe(false);
  });
  it('bmi_curc is categorical with reference 18.5-25', () => {
    const g = groupById(model, 'c:bmi_curc');
    expect(g?.referenceNote).toBe('reference: 18.5-25');
    expect(g?.rows[0].isReference).toBe(true);
  });
  it('collects continuous/binary covariates into one group', () => {
    const g = groupById(model, '__main__');
    expect(g?.variableNames).toEqual(expect.arrayContaining(['oc_ever', 'oc_current', 'bbd', 'famhist', 'height']));
  });
});

describe('buildModel — iCARE-Lit ge50', () => {
  const model = buildModel(ge50.map, ge50.formula);
  it('has 37 coefficients (rows account for all of them)', () => {
    expect(model.termCount).toBe(37);
    expect(nonRefRows(model)).toBe(37);
  });
  it('has both a cat×cat (matrix) and a cont×cat (flat) interaction', () => {
    const catCat = groupById(model, 'i:hrt×bmi_curc');
    const contCat = groupById(model, 'i:hrt_type×bmi_curc');
    expect(catCat?.matrix).toBeDefined();
    expect(contCat?.matrix).toBeUndefined();
  });
  it('retains zero-valued coefficients (the "former" level)', () => {
    const hrt = groupById(model, 'c:hrt');
    const former = hrt?.rows.find((r) => r.label.includes('former'));
    expect(former?.beta).toBe(0);
    expect(former?.expBeta).toBe(1);
  });
});

describe('buildModel — BPC3', () => {
  const model = buildModel(bpc3.map, bpc3.formula);
  it('has 77 coefficients (rows account for all of them)', () => {
    expect(model.termCount).toBe(77);
    expect(nonRefRows(model)).toBe(77);
  });
  it('keeps menopause_hrt as both a main categorical group AND an interaction member', () => {
    expect(groupById(model, 'c:menopause_hrt')).toBeDefined();
    const interaction = groupById(model, 'i:menopause_hrt×bmi');
    expect(interaction).toBeDefined();
    expect(interaction?.matrix).toBeDefined();
  });
  it('renders the menopause_hrt×bmi interaction as a 9×2 matrix of 18 estimated cells', () => {
    const m = groupById(model, 'i:menopause_hrt×bmi')?.matrix;
    expect(m?.colVar).toBe('menopause_hrt');
    expect(m?.colLevels).toEqual(['1', '2']);
    expect(m?.rowLevels).toHaveLength(9);
    let filled = 0;
    for (let r = 0; r < (m?.rowLevels.length ?? 0); r += 1) {
      for (let c = 0; c < (m?.colLevels.length ?? 0); c += 1) if (m?.cell(r, c)) filled += 1;
    }
    expect(filled).toBe(18);
  });
  it('menopause_hrt integer categorical has reference 0', () => {
    expect(groupById(model, 'c:menopause_hrt')?.referenceNote).toBe('reference: 0');
  });
});

describe('buildModel without a formula', () => {
  it('still resolves levels + reference from the self-describing keys', () => {
    const model = buildModel(lt50.map);
    expect(model.termCount).toBe(26);
    expect(groupById(model, 'c:bmi_curc')?.referenceNote).toBe('reference: 18.5-25');
  });
});

// ---- KaTeX render-safety (the "glyphs actually render" gate) ----------------

const SYNTHETIC_KEYS = [
  'C(a, Sum)[S.a1]',
  'C(a, Sum)[mean]',
  'C(a, Poly).Linear',
  'C(a, Poly).Quadratic',
  'C(a, Poly)^4',
  'C(a, Helmert)[H.a2]',
  'C(a, Helmert)[H.intercept]',
  'C(a, Diff)[D.a1]',
  'a[a1]',
  'bs(x, df=3)[0]',
  'cr(age, df=4)[2]',
  'I(x ** 2)',
  'I((x - 1) ** 2)',
  'np.log(x)',
  'center(bmi_z)',
  "Q('w.kg')",
  'Intercept',
  'x1:x2',
  "x:C(a, levels=['p','q'])[T.q]",
  'weird name & 50%',
];

function collectLatex(model: Model): string[] {
  const out = [model.compactLatex, model.scaleNoteLatex, model.expandedLatex];
  for (const g of model.groups) {
    for (const r of g.rows) if (r.covariateLatex) out.push(r.covariateLatex);
    if (g.matrix) out.push(...g.matrix.rowLevelLatex, ...g.matrix.colLevelLatex);
  }
  return out;
}

describe('KaTeX render-safety', () => {
  const strings = [
    ...collectLatex(buildModel(lt50.map, lt50.formula)),
    ...collectLatex(buildModel(ge50.map, ge50.formula)),
    ...collectLatex(buildModel(bpc3.map, bpc3.formula)),
    ...SYNTHETIC_KEYS.map((k) => termToLatex(parseDesignKey(k))),
  ];

  it('produces valid KaTeX for every generated string', () => {
    for (const tex of strings) {
      expect(() => katex.renderToString(tex, { throwOnError: true, strict: 'ignore' })).not.toThrow();
    }
  });
});
