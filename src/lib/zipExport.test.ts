// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { loadFixture, type FixtureName } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';
import { recomputeCalibration } from '../math/calibrationMath';
import {
  assembleEntries,
  buildReadme,
  buildZip,
  downloadAllZip,
  type ExportContext,
  type RasterFigure,
} from './zipExport';
import type { RebinSnapshot } from './resultsExport';
import type { RunBinSpec } from '../state/rebinStore';
import type { RunProvenance } from '../state/resultsStore';

// The pure builders + the DOM orchestrator both live here (jsdom, since the orchestrator needs Blob /
// anchor / URL). The real canvas raster path (svgToPngBlob) is injected away — jsdom has no canvas — so
// this exercises assembly, layout, README, filename, and the skip-unrendered-figure path end to end.

const NOW = new Date('2026-07-04T12:00:00.000Z');
const DEFAULT_SPEC: RunBinSpec = { numberOfPercentiles: 10, linearPredictorCutoffs: null };
const DEFAULT_PROVENANCE: RunProvenance = { mode: 'A', numImputations: null, seed: 50 };
const DEFAULT_REBIN: RebinSnapshot = {
  scale: 'linear-predictor',
  method: 'quantiles',
  numberOfPercentiles: 10,
  cutpoints: null,
};

function ctxFor(name: FixtureName): ExportContext {
  const { result } = loadFixture(name);
  const normalized = normalizeValidationResult(result);
  const rc = recomputeCalibration(normalized.perSubject, normalized.isNcc, {
    scale: 'linear-predictor',
    numberOfPercentiles: 10,
  });
  return {
    result,
    normalized,
    rc,
    rebin: DEFAULT_REBIN,
    defaultSpec: DEFAULT_SPEC,
    provenance: DEFAULT_PROVENANCE,
  };
}

describe('assembleEntries', () => {
  it('places texts under data/, figures under figures/, README at root; PNG stored uncompressed', () => {
    const figures: RasterFigure[] = [
      { name: 'age-specific-incidence-rates', svg: '<svg></svg>', png: new Uint8Array([1, 2, 3]) },
    ];
    const entries = assembleEntries(
      { 'metrics.json': '{"a":1}', 'study-data.csv': 'x\n1\n' },
      figures,
      'readme text',
    );
    expect(Object.keys(entries).sort()).toEqual([
      'README.txt',
      'data/metrics.json',
      'data/study-data.csv',
      'figures/age-specific-incidence-rates.png',
      'figures/age-specific-incidence-rates.svg',
    ]);
    // Cross-realm-safe (jsdom's Uint8Array !== fflate's): assert content, not `instanceof`.
    expect(strFromU8(entries['data/metrics.json'] as Uint8Array)).toBe('{"a":1}');
    expect(strFromU8(entries['figures/age-specific-incidence-rates.svg'] as Uint8Array)).toBe(
      '<svg></svg>',
    );
    const png = entries['figures/age-specific-incidence-rates.png'];
    expect(Array.isArray(png)).toBe(true); // tuple form [bytes, { level: 0 }]
    expect((png as [Uint8Array, { level: number }])[1].level).toBe(0);
    expect(Array.from((png as [Uint8Array, { level: number }])[0])).toEqual([1, 2, 3]);
  });
});

describe('buildZip', () => {
  it('round-trips through unzipSync with the exact entries', () => {
    const entries = assembleEntries(
      { 'metrics.json': '{"a":1}' },
      [{ name: 'roc', svg: '<svg/>', png: new Uint8Array([9, 8, 7]) }],
      'hello',
    );
    const un = unzipSync(buildZip(entries));
    expect(Object.keys(un).sort()).toEqual([
      'README.txt',
      'data/metrics.json',
      'figures/roc.png',
      'figures/roc.svg',
    ]);
    expect(strFromU8(un['data/metrics.json'])).toBe('{"a":1}');
    expect(strFromU8(un['README.txt'])).toBe('hello');
    expect(Array.from(un['figures/roc.png'])).toEqual([9, 8, 7]);
  });

  it('is byte-reproducible (fixed mtime)', () => {
    const entries = assembleEntries({ 'a.csv': '1,2' }, [], 'r');
    expect(Array.from(buildZip(entries))).toEqual(Array.from(buildZip(entries)));
  });
});

describe('buildReadme', () => {
  it('documents provenance, contents, conventions, and skipped figures', () => {
    const readme = buildReadme(
      ctxFor('bpc3-covariate'),
      ['metrics.json', 'study-data.csv'],
      ['absolute-risk-calibration'],
      ['discrimination-roc-curve'],
      NOW,
    );
    expect(readme).toContain('iCARE-validate');
    expect(readme).toContain(NOW.toISOString());
    expect(readme).toContain('Example dataset');
    expect(readme).toContain('nested case-control');
    expect(readme).toContain('absolute-risk-calibration.svg / absolute-risk-calibration.png');
    expect(readme).toContain('Not included');
    expect(readme).toContain('discrimination-roc-curve');
    expect(readme).toContain('metrics.json');
    expect(readme).toContain('NaN, Inf, -Inf');
    expect(readme).toContain('UNITS');
    expect(readme).toContain('Horvitz'); // NCC-only weighted-cohort note
  });

  it('omits the NCC weighted-cohort note for a cohort study', () => {
    const readme = buildReadme(ctxFor('icare-lit-ge50'), ['metrics.json'], [], [], NOW);
    expect(readme).not.toContain('Horvitz');
    expect(readme).toContain('cohort');
  });
});

describe('downloadAllZip (orchestrator)', () => {
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    vi.restoreAllMocks();
  });

  it('bundles live figures + data, skips unrendered figures, and names the file', async () => {
    const { result, normalized, rc } = ctxFor('icare-lit-ge50');

    const stubSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    const figures = [
      {
        name: 'age-specific-incidence-rates',
        entry: { getSvg: () => stubSvg, getBackground: () => '#fff' },
      },
      // Not rendered → must be skipped and noted in the README.
      { name: 'discrimination-roc-curve', entry: { getSvg: () => null, getBackground: () => undefined } },
    ];

    let captured: Blob | null = null;
    let downloadName = '';
    URL.createObjectURL = ((b: Blob) => {
      captured = b;
      return 'blob:x';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, 'click')
      .mockImplementation(function (this: HTMLElement) {
        downloadName = (this as HTMLAnchorElement).download;
      });

    await downloadAllZip({
      result,
      normalized,
      rc,
      rebin: DEFAULT_REBIN,
      defaultSpec: DEFAULT_SPEC,
      provenance: DEFAULT_PROVENANCE,
      figures,
      rasterize: async () => new Uint8Array([137, 80, 78, 71]),
      now: NOW,
    });
    // Let the deferred URL.revokeObjectURL timer fire while the stub is still installed.
    await new Promise((r) => setTimeout(r, 0));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe('icare-validate-example-dataset-20260704-120000.zip');
    expect(captured).not.toBeNull();

    const bytes = new Uint8Array(await (captured as unknown as Blob).arrayBuffer());
    const un = unzipSync(bytes);
    const keys = Object.keys(un);
    expect(keys).toContain('README.txt');
    expect(keys).toContain('data/metrics.json');
    expect(keys).toContain('data/study-data.csv');
    expect(keys).toContain('data/calibration-current-view.csv');
    expect(keys).toContain('figures/age-specific-incidence-rates.svg');
    expect(keys).toContain('figures/age-specific-incidence-rates.png');
    // The unrendered figure is absent from the ZIP but named in the README.
    expect(keys).not.toContain('figures/discrimination-roc-curve.svg');
    expect(strFromU8(un['README.txt'])).toContain('discrimination-roc-curve');
    // Injected raster bytes flow through to the archived PNG.
    expect(Array.from(un['figures/age-specific-incidence-rates.png'])).toEqual([137, 80, 78, 71]);
  });
});
