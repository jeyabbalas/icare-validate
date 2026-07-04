import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadFixture, type FixtureName } from './fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';
import { discriminationDensities, gaussianKde, gaussianKdeBandwidth } from './kde';

// The Phase-10 faithfulness anchor: seaborn's kdeplot (what py-icare's demo notebook draws) IS
// scipy.stats.gaussian_kde with the bandwidth scaled by bw_adjust, so kde.ts must reproduce scipy. The
// golden densities in kde-<name>.json are dumped by scripts/verify-kde.mjs (scipy in the vendored Pyodide,
// silverman rule × bw_adjust 0.5) on a shared grid; here we evaluate kde.ts on that SAME grid and assert a
// pointwise match — isolating the KDE math (bandwidth + kernel sum) from grid construction.

interface KdeReference {
  grid: number[];
  caseDensity: number[];
  controlDensity: number[];
  caseBw: number;
  controlBw: number;
  overlap: number;
}

function loadKdeReference(name: FixtureName): KdeReference | null {
  const viaModule = fileURLToPath(new URL(`./fixtures/kde-${name}.json`, import.meta.url));
  const file = existsSync(viaModule)
    ? viaModule
    : path.join(process.cwd(), 'src', 'math', 'fixtures', `kde-${name}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as KdeReference) : null;
}

// NaN-aware relative closeness (reused shape from calibrationMath.parity.test.ts). Densities peak in the
// hundreds, so a relative tolerance is the right yardstick for the exp-sum over thousands of subjects.
function expectClose(actual: number, expected: number, abs = 1e-7, rel = 1e-6): void {
  if (Math.abs(actual - expected) > abs + rel * Math.abs(expected)) {
    expect(actual).toBeCloseTo(expected, 8);
  }
}

/** Split the normalized per-subject risks into case / control values + IPW weights (null for a cohort). */
function split(name: FixtureName) {
  const { result } = loadFixture(name);
  const norm = normalizeValidationResult(result);
  const { riskEstimates: risk, observedOutcome: outcome, frequency } = norm.perSubject;
  const caseRisk: number[] = [];
  const caseW: number[] = [];
  const ctrlRisk: number[] = [];
  const ctrlW: number[] = [];
  for (let i = 0; i < risk.length; i += 1) {
    const w = norm.isNcc ? frequency![i] : 1;
    if (outcome[i] === 1) {
      caseRisk.push(risk[i]);
      caseW.push(w);
    } else {
      ctrlRisk.push(risk[i]);
      ctrlW.push(w);
    }
  }
  const wCase = norm.isNcc ? caseW : null;
  const wCtrl = norm.isNcc ? ctrlW : null;
  return { norm, caseRisk, wCase, ctrlRisk, wCtrl };
}

const CASES: FixtureName[] = ['icare-lit-ge50', 'bpc3-covariate'];

describe.each(CASES)('KDE ⇄ scipy gaussian_kde parity — %s', (name) => {
  const ref = loadKdeReference(name);
  const gate = ref ? it : it.skip; // skip cleanly if `npm run verify:kde` hasn't been run
  if (!ref) {
    it('kde reference fixture present', () => {
      expect(ref, `run "npm run verify:kde" to generate kde-${name}.json`).not.toBeNull();
    });
    return;
  }

  const { norm, caseRisk, wCase, ctrlRisk, wCtrl } = split(name);

  gate('reproduces the scipy bandwidth (silverman × 0.5) for both groups', () => {
    expectClose(gaussianKdeBandwidth(caseRisk, wCase), ref.caseBw, 1e-12, 1e-9);
    expectClose(gaussianKdeBandwidth(ctrlRisk, wCtrl), ref.controlBw, 1e-12, 1e-9);
  });

  gate('reproduces the scipy case + control densities pointwise on the shared grid', () => {
    const caseD = gaussianKde(caseRisk, wCase, ref.grid);
    const ctrlD = gaussianKde(ctrlRisk, wCtrl, ref.grid);
    expect(caseD.length).toBe(ref.grid.length);
    for (let j = 0; j < ref.grid.length; j += 1) {
      expectClose(caseD[j], ref.caseDensity[j]);
      expectClose(ctrlD[j], ref.controlDensity[j]);
    }
  });

  gate('the engine overlap coefficient matches scipy within grid tolerance', () => {
    const d = discriminationDensities(norm.perSubject, norm.isNcc);
    expectClose(d.overlap, ref.overlap, 1e-4, 1e-3);
  });
});
