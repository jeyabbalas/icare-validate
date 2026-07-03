// Renders a Patsy covariate model as elegant LaTeX for domain experts.
//
// The authoritative input is the **log-relative-risk map** (`Record<designMatrixColumn, β>`), whose
// keys are py-icare's patsy `design_info.column_names` verbatim (the Intercept is always dropped, so it
// is never a key). py-icare imposes no formula-syntax restriction — it delegates fully to patsy — so
// this module must be a **total function** over the entire space of patsy column-name strings: it
// renders known constructs elegantly (Tier 1: indicators + interactions, as used by real iCARE models;
// Tier 2: other contrasts, transforms, splines, Q(), intercept) and degrades gracefully to a literal
// `\texttt{…}` echo for anything unrecognized (Tier 3) — never throwing, always pairing each column with
// its β and exp(β).
//
// The optional formula string is a *secondary* enrichment (reference levels / variable ordering); it is
// keyed by variable NAME, never string-matched against the JSON keys, because patsy re-spaces the keys
// (`levels=['a', 'b']`) differently from a compact formula (`levels=['a','b']`).
//
// Pure module: no React, no DOM, no I/O. All LaTeX targets KaTeX math mode.

// ---- Types -----------------------------------------------------------------

export type FactorKind = 'numeric' | 'categorical' | 'transform' | 'intercept' | 'raw';

export type ContrastKind =
  | 'treatment'
  | 'sum'
  | 'poly'
  | 'helmert'
  | 'diff'
  | 'fullrank'
  | 'custom'
  | 'spline'
  | 'other';

/** One factor of a design-matrix term (a term is factors joined by top-level `:`). Structural only. */
export interface Factor {
  kind: FactorKind;
  name: string; // variable name (unwrapped) or factor code
  raw: string; // the original factor token (tooltip / transform / raw rendering)
  level?: string; // categorical level inside the bracket / poly degree tag / spline index
  levels?: string[] | null; // full level list when known (from the key or the formula)
  reference?: string | null; // reference (baseline) level when known
  contrast?: ContrastKind;
}

/** A single row of the coefficient table. */
export interface CoefRow {
  key: string | null; // verbatim patsy column key; null for a synthesized reference row
  beta: number;
  expBeta: number;
  covariateLatex: string; // inline KaTeX for the covariate x_j; '' for a reference row
  label: string; // plain-text (non-LaTeX) description
  isReference: boolean;
}

export type GroupKind = 'numeric' | 'categorical' | 'interaction' | 'transform' | 'other';

/** For a categorical×categorical interaction: a compact grid instead of a long flat list. */
export interface InteractionMatrix {
  rowVar: string;
  colVar: string;
  rowLevels: string[];
  colLevels: string[];
  rowLevelLatex: string[];
  colLevelLatex: string[];
  cell: (r: number, c: number) => { beta: number; expBeta: number; key: string } | null;
}

export interface CoefGroup {
  kind: GroupKind;
  id: string;
  title: string;
  variableNames: string[];
  referenceNote?: string;
  rows: CoefRow[];
  matrix?: InteractionMatrix;
  warnings: string[];
}

export interface Model {
  groups: CoefGroup[];
  termCount: number; // number of (non-reference) coefficients == Object.keys(logOR).length
  hasInteractions: boolean;
  compactLatex: string; // RR(x) = exp( Σ_j β_j x_j )
  scaleNoteLatex: string; // β_j = log RR_j
  expandedLatex: string; // fully-expanded η = Σ … (lazy-rendered by the UI)
  warnings: string[];
}

export interface FormulaSpec {
  levels: string[];
  reference: string | null;
}

// ---- Tokenizers ------------------------------------------------------------

/**
 * Split `s` on `sep` only at bracket/paren depth 0. This isolates the factors of an interaction key
 * (top-level `:`) while protecting colons/commas inside `C(...)`, `levels=[...]`, `[T.…]`, and Python
 * slices like `I(x[0:2])`. Not quote-aware — level lists use `parseLevelsList` instead.
 */
export function splitTopLevel(s: string, sep: ':' | ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}

/**
 * Parse the inner text of a `levels=[…]` list into item strings, quote-aware so a comma inside a quoted
 * level is preserved. Quotes are stripped; bare integer levels (`0, 1, 2`) become their string form.
 * `'a', 'b'` and `'a','b'` yield the same result — this is what neutralizes the formula/JSON whitespace
 * difference.
 */
export function parseLevelsList(inner: string): string[] {
  if (inner.trim() === '') return [];
  const items: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ',') {
      items.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  items.push(buf.trim());
  return items;
}

/** Count of net unclosed parentheses in `s` (used to reject a trailing `[...]` that sits inside parens). */
function parenDepth(s: string): number {
  let d = 0;
  for (const ch of s) {
    if (ch === '(') d += 1;
    else if (ch === ')') d -= 1;
  }
  return d;
}

/**
 * Index of the `[` that opens a trailing suffix bracket at top level (paren- and bracket-depth 0), or
 * -1. `C(x, levels=[...])[T.a]` → the `[T.a]` opener; `bs(x, df=3)[0]` → the `[0]` opener; `I(x[0:2])`
 * → -1 (the bracket is inside parens, a slice, not a suffix).
 */
function findSuffixBracket(token: string): number {
  if (!token.endsWith(']')) return -1;
  let p = 0;
  let b = 0;
  let bracketStart = -1;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '(') p += 1;
    else if (ch === ')') p -= 1;
    else if (ch === '[') {
      if (p === 0 && b === 0) bracketStart = i;
      b += 1;
    } else if (ch === ']') {
      b -= 1;
    }
  }
  return bracketStart;
}

// ---- Factor parsing --------------------------------------------------------

const POLY_TAIL = /^(.*)(\.(?:Constant|Linear|Quadratic|Cubic)|\^\d+)$/;

/** Parse one factor token (already `:`-split) into a structural `Factor`. Never throws. */
export function parseFactor(token: string, specs?: Map<string, FormulaSpec>): Factor {
  const t = token.trim();
  try {
    return parseFactorInner(t, specs);
  } catch {
    return { kind: 'raw', name: t, raw: t };
  }
}

function parseFactorInner(token: string, specs?: Map<string, FormulaSpec>): Factor {
  if (token === 'Intercept' || token === '1') {
    return { kind: 'intercept', name: 'Intercept', raw: token };
  }

  // Bracket-less Poly tail (`C(x, Poly).Linear`, `…^4`).
  const poly = token.match(POLY_TAIL);
  if (poly && poly[1].endsWith(')')) {
    const { varName } = resolveCategorical(poly[1], specs);
    return {
      kind: 'categorical',
      name: varName,
      raw: token,
      contrast: 'poly',
      level: poly[2].replace(/^\./, ''),
    };
  }

  // Trailing suffix bracket → categorical / spline / full-rank level.
  const sfx = findSuffixBracket(token);
  if (sfx >= 0 && parenDepth(token.slice(0, sfx)) === 0) {
    const code = token.slice(0, sfx);
    const inner = token.slice(sfx + 1, token.length - 1);
    return parseBracketFactor(token, code, inner, specs);
  }

  // No suffix → continuous / transform.
  return parseContinuousFactor(token);
}

const TAG_TO_CONTRAST = { T: 'treatment', S: 'sum', H: 'helmert', D: 'diff' } as const;

function parseBracketFactor(
  raw: string,
  code: string,
  inner: string,
  specs?: Map<string, FormulaSpec>,
): Factor {
  const tag = inner.match(/^([TSHD])\.([\s\S]*)$/);
  if (tag) {
    const contrast = TAG_TO_CONTRAST[tag[1] as keyof typeof TAG_TO_CONTRAST];
    const { varName, levels, reference } = resolveCategorical(code, specs);
    return { kind: 'categorical', name: varName, raw, contrast, level: tag[2], levels, reference };
  }
  if (inner === 'mean') {
    const { varName } = resolveCategorical(code, specs);
    return { kind: 'categorical', name: varName, raw, contrast: 'sum', level: 'mean' };
  }
  if (/^custom\d+$/.test(inner)) {
    const { varName } = resolveCategorical(code, specs);
    return { kind: 'categorical', name: varName, raw, contrast: 'custom', level: inner };
  }
  // A bare integer index on a function code (not `C(...)`) is a spline / multi-column basis.
  if (/^\d+$/.test(inner) && !/^C\s*\(/.test(code)) {
    return { kind: 'transform', name: code, raw, contrast: 'spline', level: inner };
  }
  // Otherwise a full-rank bare categorical level (`a[a1]`, `C(a)[a1]`, `C(a, …)[2]`).
  const { varName, levels, reference } = resolveCategorical(code, specs);
  return { kind: 'categorical', name: varName, raw, contrast: 'fullrank', level: inner, levels, reference };
}

function parseContinuousFactor(token: string): Factor {
  const q = token.match(/^Q\(\s*(['"])([\s\S]*)\1\s*\)$/);
  if (q) return { kind: 'numeric', name: q[2], raw: token };
  if (/^I\([\s\S]*\)$/.test(token)) return { kind: 'transform', name: token, raw: token };
  if (/^[A-Za-z_][\w.]*\([\s\S]*\)$/.test(token)) return { kind: 'transform', name: token, raw: token };
  if (/^[A-Za-z_]\w*$/.test(token)) return { kind: 'numeric', name: token, raw: token };
  return { kind: 'raw', name: token, raw: token };
}

/** Parse a design key into its factors (main effect = 1, interaction = ≥2). */
export function parseDesignKey(key: string, specs?: Map<string, FormulaSpec>): Factor[] {
  return splitTopLevel(key, ':').map((t) => parseFactor(t, specs));
}

// ---- C(...) code helpers ---------------------------------------------------

function unwrapQ(s: string): string {
  const m = s.match(/^Q\(\s*(['"])([\s\S]*)\1\s*\)$/);
  return m ? m[2] : s;
}

/** Extract the variable name and (optional) levels list from a `C(var, …)` code. */
function extractCVar(code: string): { name: string; levels: string[] | null } | null {
  const m = code.match(/^C\s*\(\s*([^,)]+?)\s*(?:,([\s\S]*))?\)$/);
  if (!m) return null;
  return { name: unwrapQ(m[1].trim()), levels: extractLevelsFromArgs(m[2] ?? '') };
}

/** Pull a `levels=[…]` list out of a `C(...)` argument string, matching `]` quote-aware. */
function extractLevelsFromArgs(args: string): string[] | null {
  const idx = args.indexOf('levels');
  if (idx < 0) return null;
  const lb = args.indexOf('[', idx);
  if (lb < 0) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = lb; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return parseLevelsList(args.slice(lb + 1, i));
    }
  }
  return null;
}

/** Resolve a categorical factor's variable, levels, and reference from its code (+ formula fallback). */
function resolveCategorical(
  code: string,
  specs?: Map<string, FormulaSpec>,
): { varName: string; levels: string[] | null; reference: string | null } {
  const cv = extractCVar(code);
  const name = cv ? cv.name : unwrapQ(code.trim());
  let levels = cv?.levels ?? null;
  let reference = levels && levels.length ? levels[0] : null;
  if ((!levels || levels.length === 0) && specs?.has(name)) {
    const spec = specs.get(name)!;
    levels = spec.levels;
    reference = spec.reference;
  }
  return { varName: name, levels, reference };
}

/** The base variable of a function code, e.g. `bs(x, df=3)` → `x`; falls back to the code itself. */
function baseVarOfCode(code: string): string {
  const m = code.match(/^[A-Za-z_][\w.]*\(([\s\S]*)\)$/);
  return m ? firstArg(m[1]) : code;
}

function firstArg(args: string): string {
  return splitTopLevel(args, ',')[0]?.trim() ?? args.trim();
}

// ---- LaTeX rendering -------------------------------------------------------

const TEXT_ESCAPE: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '#': '\\#',
  '%': '\\%',
  '&': '\\&',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

/** Escape a string for use inside KaTeX `\text{…}`/`\texttt{…}` (single pass — no re-escaping). */
export function escapeTextMode(s: string): string {
  return s.replace(/[\\{}$#%&_^~]/g, (c) => TEXT_ESCAPE[c]);
}

/**
 * Render a category level as LaTeX: a leading comparator becomes a math relation kept OUTSIDE `\text{}`
 * (KaTeX errors on `\leq` inside text mode); the body is upright text with `-` between numbers shown as
 * an en-dash via the text-mode `\textendash` command.
 */
export function prettyLevelLatex(level: string): string {
  const m = level.match(/^(<=|>=|<|>)?([\s\S]*)$/);
  const op = m?.[1];
  const body = m?.[2] ?? '';
  const opTex =
    op === '<=' ? '{\\leq}' : op === '>=' ? '{\\geq}' : op === '<' ? '{<}' : op === '>' ? '{>}' : '';
  if (body === '') return opTex || '\\text{}';
  const bodyTex = `\\text{${escapeTextMode(body).replace(/(\d)-(\d)/g, '$1\\textendash{}$2')}}`;
  return opTex + bodyTex;
}

/** Plain-text (non-LaTeX) prettified level for the description column. */
function prettyLevelText(level: string): string {
  return level.replace(/<=/g, '≤').replace(/>=/g, '≥');
}

function indicatorLatex(varName: string, level: string): string {
  return `\\mathbb{1}\\{\\text{${escapeTextMode(varName)}} = ${prettyLevelLatex(level)}\\}`;
}

function polyDegree(lvl: string): string {
  const map: Record<string, number> = { Constant: 0, Linear: 1, Quadratic: 2, Cubic: 3 };
  if (lvl in map) return String(map[lvl]);
  const m = lvl.match(/\^?(\d+)/);
  return m ? m[1] : escapeTextMode(lvl);
}

function categoricalLatex(f: Factor): string {
  const v = escapeTextMode(f.name);
  const lvl = f.level ?? '';
  switch (f.contrast) {
    case 'sum':
      return lvl === 'mean' ? `\\overline{\\text{${v}}}` : `S_{${prettyLevelLatex(lvl)}}(\\text{${v}})`;
    case 'helmert':
      return lvl === 'intercept'
        ? `\\text{${v}}_{H0}`
        : `H_{${prettyLevelLatex(lvl)}}(\\text{${v}})`;
    case 'diff':
      return `D_{${prettyLevelLatex(lvl)}}(\\text{${v}})`;
    case 'poly':
      return `P_{${polyDegree(lvl)}}(\\text{${v}})`;
    case 'custom':
      return `\\text{${v}}\\,[${escapeTextMode(lvl)}]`;
    default: // treatment | fullrank | other
      return indicatorLatex(f.name, lvl);
  }
}

function transformExprLatex(expr: string): string {
  let e = expr.trim();
  e = e.replace(/\s*\*\*\s*([A-Za-z0-9.]+)/g, '^{$1}');
  e = e.replace(/\s*\*\s*/g, ' \\cdot ');
  e = e.replace(/[A-Za-z_]\w*/g, (m) => `\\text{${escapeTextMode(m)}}`);
  return e;
}

function funcLatex(fn: string, args: string): string {
  const a = `\\text{${escapeTextMode(firstArg(args))}}`;
  switch (fn.replace(/^np\./, '')) {
    case 'log':
      return `\\log(${a})`;
    case 'log10':
      return `\\log_{10}(${a})`;
    case 'log2':
      return `\\log_{2}(${a})`;
    case 'exp':
      return `e^{${a}}`;
    case 'sqrt':
      return `\\sqrt{${a}}`;
    case 'center':
      return `(${a} - \\bar{${a}})`;
    case 'standardize':
    case 'scale':
      return `z_{${a}}`;
    default:
      return `\\operatorname{${escapeTextMode(fn)}}(${a})`;
  }
}

function transformLatex(f: Factor): string {
  if (f.contrast === 'spline') {
    const i = Number.parseInt(f.level ?? '0', 10);
    return `B_{${i + 1}}(\\text{${escapeTextMode(baseVarOfCode(f.name))}})`;
  }
  const token = f.raw;
  const iMatch = token.match(/^I\(([\s\S]*)\)$/);
  if (iMatch) return transformExprLatex(iMatch[1]);
  const fn = token.match(/^([A-Za-z_][\w.]*)\(([\s\S]*)\)$/);
  if (fn) return funcLatex(fn[1], fn[2]);
  return `\\texttt{${escapeTextMode(token)}}`;
}

/** LaTeX for a single factor's covariate x_j. */
export function factorToLatex(f: Factor): string {
  switch (f.kind) {
    case 'intercept':
      return '\\text{(Intercept)}';
    case 'numeric':
      return `\\text{${escapeTextMode(f.name)}}`;
    case 'raw':
      return `\\texttt{${escapeTextMode(f.raw)}}`;
    case 'transform':
      return transformLatex(f);
    case 'categorical':
      return categoricalLatex(f);
  }
}

/** LaTeX for a whole term = product of its factors. */
export function termToLatex(factors: Factor[]): string {
  return factors.map(factorToLatex).join(' \\cdot ');
}

// ---- Plain-text labels -----------------------------------------------------

function factorLabel(f: Factor): string {
  if (f.kind === 'categorical') {
    if (f.contrast === 'treatment' || f.contrast === 'fullrank' || f.contrast === undefined) {
      return `${f.name} = ${prettyLevelText(f.level ?? '')}`;
    }
    return `${f.name} (${f.contrast} ${f.level ?? ''})`.trim();
  }
  if (f.kind === 'transform') return f.raw;
  return f.name;
}

function interactionLabel(factors: Factor[]): string {
  return factors.map(factorLabel).join(' × ');
}

// ---- Numbers ---------------------------------------------------------------

/** Fixed-decimal format for tabular alignment; non-finite → em dash. */
export function formatNumber(x: number, dp = 3): string {
  return Number.isFinite(x) ? x.toFixed(dp) : '—';
}

// ---- Formula enrichment ----------------------------------------------------

/** Map each `C(var, levels=[…])` in the formula to its levels + reference, keyed by variable name. */
export function parseFormulaSpecs(formula: string): Map<string, FormulaSpec> {
  const specs = new Map<string, FormulaSpec>();
  for (const code of findCCodes(formula)) {
    const cv = extractCVar(code);
    if (cv && cv.levels && cv.levels.length && !specs.has(cv.name)) {
      specs.set(cv.name, { levels: cv.levels, reference: cv.levels[0] });
    }
  }
  return specs;
}

/** Every balanced `C(...)` code in a formula string (quote- and paren-aware). */
function findCCodes(formula: string): string[] {
  const codes: string[] = [];
  const re = /C\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    const open = m.index + m[0].length - 1; // index of '('
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = open; i < formula.length; i += 1) {
      const ch = formula[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    codes.push(formula.slice(m.index, end + 1));
    re.lastIndex = end + 1;
  }
  return codes;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Index of a variable's first whole-word occurrence in the formula (for group ordering). */
function firstIndexInFormula(formula: string, name: string): number {
  const re = new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?![\\w.])`);
  const m = re.exec(formula);
  return m ? m.index : Number.MAX_SAFE_INTEGER;
}

// ---- Model assembly --------------------------------------------------------

interface ParsedTerm {
  key: string;
  beta: number;
  factors: Factor[];
}

interface Bucket {
  kind: GroupKind;
  id: string;
  title: string;
  vars: string[];
  terms: ParsedTerm[];
}

/** Build the full renderable model from the coefficient map and (optionally) the formula. */
export function buildModel(logOR: Record<string, number>, formula?: string | null): Model {
  const specs = formula ? parseFormulaSpecs(formula) : new Map<string, FormulaSpec>();
  const terms: ParsedTerm[] = Object.entries(logOR).map(([key, beta]) => ({
    key,
    beta,
    factors: parseDesignKey(key, specs),
  }));

  // Bucket terms into groups, preserving first-seen order.
  const buckets: Bucket[] = [];
  const byId = new Map<string, Bucket>();
  const bucketOf = (kind: GroupKind, id: string, title: string, vars: string[]): Bucket => {
    let b = byId.get(id);
    if (!b) {
      b = { kind, id, title, vars, terms: [] };
      byId.set(id, b);
      buckets.push(b);
    }
    return b;
  };

  for (const t of terms) {
    if (t.factors.length >= 2) {
      const vars = t.factors.map((f) => f.name);
      bucketOf('interaction', `i:${vars.join('×')}`, vars.join(' × '), vars).terms.push(t);
      continue;
    }
    const f = t.factors[0];
    if (f.kind === 'categorical') {
      bucketOf('categorical', `c:${f.name}`, f.name, [f.name]).terms.push(t);
    } else if (f.kind === 'transform') {
      const base = baseVarOfCode(f.name);
      bucketOf('transform', `t:${base}`, transformTitle(f, base), [base]).terms.push(t);
    } else {
      bucketOf('numeric', '__main__', 'Continuous & binary covariates', []).terms.push(t);
    }
  }

  let groups = buckets.map((b) => renderGroup(b));

  if (formula) {
    const key = (g: CoefGroup): number =>
      g.variableNames.length
        ? Math.min(...g.variableNames.map((n) => firstIndexInFormula(formula, n)))
        : Number.MAX_SAFE_INTEGER;
    groups = groups
      .map((g, i) => ({ g, i, k: key(g) }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map((w) => w.g);
  }

  return {
    groups,
    termCount: terms.length,
    hasInteractions: groups.some((g) => g.kind === 'interaction'),
    compactLatex: '\\mathrm{RR}(\\mathbf{x}) = \\exp\\!\\left(\\sum_{j} \\beta_j\\, x_j\\right)',
    scaleNoteLatex: '\\beta_j = \\log \\mathrm{RR}_j',
    expandedLatex: buildExpandedLatex(terms),
    warnings: terms.length === 0 ? ['No coefficients found.'] : [],
  };
}

function transformTitle(f: Factor, base: string): string {
  return f.contrast === 'spline' ? `${base} — spline basis` : f.raw;
}

function renderGroup(b: Bucket): CoefGroup {
  if (b.kind === 'categorical') return renderCategorical(b);
  if (b.kind === 'interaction') return renderInteraction(b);
  return {
    kind: b.kind,
    id: b.id,
    title: b.title,
    variableNames: b.kind === 'numeric' ? b.terms.map((t) => t.factors[0].name) : b.vars,
    rows: b.terms.map((t) => ({
      key: t.key,
      beta: t.beta,
      expBeta: Math.exp(t.beta),
      covariateLatex: factorToLatex(t.factors[0]),
      label: b.kind === 'numeric' ? t.factors[0].name : t.factors[0].raw,
      isReference: false,
    })),
    warnings: [],
  };
}

function renderCategorical(b: Bucket): CoefGroup {
  const f0 = b.terms[0].factors[0];
  const levels = f0.levels ?? null;
  const reference = f0.reference ?? null;

  const sorted = [...b.terms];
  if (levels && levels.length) {
    const rank = new Map(levels.map((l, i) => [l, i]));
    sorted.sort(
      (x, y) =>
        (rank.get(x.factors[0].level ?? '') ?? 1e9) - (rank.get(y.factors[0].level ?? '') ?? 1e9),
    );
  }

  const rows: CoefRow[] = [];
  if (reference != null) {
    rows.push({
      key: null,
      beta: 0,
      expBeta: 1,
      covariateLatex: '',
      label: `${prettyLevelText(reference)} (reference)`,
      isReference: true,
    });
  }
  for (const t of sorted) {
    const f = t.factors[0];
    rows.push({
      key: t.key,
      beta: t.beta,
      expBeta: Math.exp(t.beta),
      covariateLatex: factorToLatex(f),
      label: factorLabel(f),
      isReference: false,
    });
  }

  return {
    kind: 'categorical',
    id: b.id,
    title: b.title,
    variableNames: [f0.name],
    referenceNote: reference != null ? `reference: ${prettyLevelText(reference)}` : undefined,
    rows,
    warnings: reference == null ? ['Reference level unspecified.'] : [],
  };
}

function renderInteraction(b: Bucket): CoefGroup {
  const rows: CoefRow[] = b.terms.map((t) => ({
    key: t.key,
    beta: t.beta,
    expBeta: Math.exp(t.beta),
    covariateLatex: termToLatex(t.factors),
    label: interactionLabel(t.factors),
    isReference: false,
  }));

  const isCat2 =
    b.vars.length === 2 &&
    b.terms.every((t) => t.factors.length === 2 && t.factors.every((f) => f.kind === 'categorical'));

  return {
    kind: 'interaction',
    id: b.id,
    title: b.title,
    variableNames: b.vars,
    rows,
    matrix: isCat2 ? makeMatrix(b) : undefined,
    warnings: [],
  };
}

function makeMatrix(b: Bucket): InteractionMatrix {
  const f0 = b.terms[0].factors;
  const levelsA = collectLevels(b, 0);
  const levelsB = collectLevels(b, 1);
  // Fewer levels → columns, more → rows (keeps the grid tall-and-narrow).
  const aIsCol = levelsA.length <= levelsB.length;
  const colPos = aIsCol ? 0 : 1;
  const rowPos = aIsCol ? 1 : 0;
  const colVar = f0[colPos].name;
  const rowVar = f0[rowPos].name;
  const colLevels = aIsCol ? levelsA : levelsB;
  const rowLevels = aIsCol ? levelsB : levelsA;

  const lookup = new Map<string, { beta: number; expBeta: number; key: string }>();
  for (const t of b.terms) {
    const rk = t.factors[rowPos].level ?? '';
    const ck = t.factors[colPos].level ?? '';
    lookup.set(`${rk} ${ck}`, { beta: t.beta, expBeta: Math.exp(t.beta), key: t.key });
  }

  return {
    rowVar,
    colVar,
    rowLevels,
    colLevels,
    rowLevelLatex: rowLevels.map(prettyLevelLatex),
    colLevelLatex: colLevels.map(prettyLevelLatex),
    cell: (r, c) => lookup.get(`${rowLevels[r]} ${colLevels[c]}`) ?? null,
  };
}

/** Ordered, unique non-reference levels present for the factor at `pos` (canonical order when known). */
function collectLevels(b: Bucket, pos: number): string[] {
  const canon = b.terms[0].factors[pos].levels ?? null;
  const present = new Set(b.terms.map((t) => t.factors[pos].level ?? ''));
  if (canon) return canon.filter((l) => present.has(l));
  return [...present];
}

function buildExpandedLatex(terms: ParsedTerm[]): string {
  if (terms.length === 0) return '\\log \\mathrm{RR} = 0';
  const pieces = terms.map((t) => {
    const sign = t.beta < 0 ? '-' : '+';
    return `${sign} ${formatNumber(Math.abs(t.beta))}\\,${termToLatex(t.factors)}`;
  });
  pieces[0] = pieces[0].replace(/^\+ /, '');
  const lines: string[] = [];
  for (let i = 0; i < pieces.length; i += 3) lines.push(pieces.slice(i, i + 3).join(' '));
  return `\\begin{aligned}\n\\log \\mathrm{RR} &= ${lines.join(' \\\\\n&\\quad ')}\n\\end{aligned}`;
}
