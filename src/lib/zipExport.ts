import { strToU8, zipSync, type Zippable } from 'fflate';
import { downloadBlob, svgToPngBlob, svgToString } from './figureExport';
import { collectResultFiles, slugify, type RebinSnapshot } from './resultsExport';
import { PYICARE_VERSION } from './icareTypes';
import { listResultsFigures, type FigureEntry } from '../viz/figureRegistry';
import type { NormalizedResult } from '../services/resultNormalizer';
import type { RecomputedCalibration } from '../math/calibrationMath';
import type { RunBinSpec } from '../state/rebinStore';
import type { RunProvenance } from '../state/resultsStore';
import type { ValidationResult } from './icareTypes';

// Phase 13 — "Download all": bundle every figure (SVG + PNG) + every result table (from resultsExport)
// + a human-readable README into one ZIP via fflate. Layered so all but the final raster + browser
// download is pure and node-testable: `collectResultFiles` (text) and `buildReadme` produce strings,
// `assembleEntries` + `buildZip` turn strings + already-rasterized figures into ZIP bytes, and only the
// thin `downloadAllZip` orchestrator touches the DOM (reads the live figure registry, rasterizes each
// <svg> to PNG, triggers the download). Figures and the clock are injectable so a test can drive the
// orchestrator with stub nodes and a fixed date.

/** A figure already turned into its two serialized forms, ready to place in the ZIP. */
export interface RasterFigure {
  name: string;
  svg: string;
  png: Uint8Array;
}

/** Everything the exporters need from the results view. */
export interface ExportContext {
  result: ValidationResult;
  normalized: NormalizedResult;
  rc: RecomputedCalibration;
  rebin: RebinSnapshot;
  defaultSpec: RunBinSpec | null;
  provenance: RunProvenance | null;
}

// A fixed timestamp for every ZIP entry so the archive bytes are reproducible (fflate defaults each
// entry's mtime to "now"). The export's real timestamp lives in metrics.json + the README.
const ZIP_MTIME = new Date('2020-01-01T00:00:00Z');

// One-line description per data file, in the order they should appear in the README.
const DATA_FILE_DESCRIPTIONS: [string, string][] = [
  ['metrics.json', 'Headline metrics + provenance (sdkAsRun + currentView blocks).'],
  ['cohort-summary.csv', 'Cohort descriptives: N, cases, follow-up, baseline age.'],
  ['cohort-summary.json', 'Cohort descriptives as JSON.'],
  ['calibration-sdk-default.csv', "SDK's as-run per-bin calibration (default binning)."],
  ['calibration-current-view.csv', 'Per-bin calibration for the current on-screen binning.'],
  ['study-data.csv', 'Per-subject frame: risks, linear predictors, bin labels, outcomes.'],
  ['incidence-rates.csv', 'Age-specific study vs population incidence rates.'],
  ['reference-distribution.csv', 'Reference-population risk score + absolute risk (if available).'],
];

function describeSdkBinning(spec: RunBinSpec | null): string {
  if (!spec) return 'unknown (no run captured)';
  if (spec.linearPredictorCutoffs && spec.linearPredictorCutoffs.length) {
    return `linear predictor, custom cutoffs [${spec.linearPredictorCutoffs.join(', ')}]`;
  }
  return `linear predictor, ${spec.numberOfPercentiles} equal-count (quantile) bins`;
}

function describeCurrentBinning(rebin: RebinSnapshot, rc: RecomputedCalibration): string {
  const scale = rebin.scale === 'absolute-risk' ? 'absolute risk' : 'linear predictor';
  if (rebin.method === 'cutpoints' && rebin.cutpoints && rebin.cutpoints.length) {
    const unit = rebin.scale === 'absolute-risk' ? '%' : '';
    return `${scale}, cutpoints [${rebin.cutpoints.join(', ')}]${unit} → ${rc.nBins} bins`;
  }
  return `${scale}, ${rebin.numberOfPercentiles} equal-count (quantile) bins → ${rc.nBins} bins`;
}

/** The README/manifest: provenance, contents, the two binnings, and the NaN/Inf + units conventions. */
export function buildReadme(
  ctx: ExportContext,
  dataFiles: string[],
  figures: string[],
  missing: string[],
  now: Date,
): string {
  const { result, normalized, rebin, rc, defaultSpec, provenance } = ctx;
  const info = result.info;
  const L: string[] = [];
  L.push('iCARE-validate — validation export');
  L.push('==================================');
  L.push('');
  L.push(`Exported:       ${now.toISOString()}`);
  L.push(`Dataset:        ${info.datasetName || '(unnamed)'}`);
  L.push(`Model:          ${info.modelName || '(unnamed)'}`);
  L.push(`Risk interval:  ${info.riskPredictionInterval}`);
  L.push(
    `Study design:   ${normalized.isNcc ? 'nested case-control (inverse-probability weighted)' : 'cohort'}`,
  );
  L.push(`Engine:         py-icare ${PYICARE_VERSION} — ${result.method}`);
  if (provenance) {
    // Mode A imputes missing covariates (num_imputations, default 5); Mode B uses precomputed risks.
    const imp =
      provenance.mode === 'A'
        ? `${provenance.numImputations ?? 5}${provenance.numImputations == null ? ' (default)' : ''}`
        : 'n/a (precomputed risks)';
    L.push(`Run:            Mode ${provenance.mode} · imputations ${imp} · seed ${provenance.seed}`);
  }
  L.push('');

  L.push('FIGURES (figures/)');
  L.push('------------------');
  L.push('Each chart is a vector .svg (transparent) and a raster .png (surface-filled):');
  for (const n of figures) L.push(`  ${n}.svg / ${n}.png`);
  if (missing.length) {
    L.push('');
    L.push('Not included (were not rendered at export time):');
    for (const n of missing) L.push(`  ${n}`);
  }
  L.push('');

  L.push('DATA (data/)');
  L.push('------------');
  for (const [file, desc] of DATA_FILE_DESCRIPTIONS) {
    if (dataFiles.includes(file)) L.push(`  ${file.padEnd(30)}${desc}`);
  }
  L.push('');

  L.push('BINNING');
  L.push('-------');
  L.push('  As run by the SDK (calibration-sdk-default.csv; metrics.json -> sdkAsRun):');
  L.push(`    ${describeSdkBinning(defaultSpec)}`);
  L.push('  Current on-screen view (calibration-current-view.csv; metrics.json -> currentView):');
  L.push(`    ${describeCurrentBinning(rebin, rc)}`);
  L.push('  AUC, Brier score, and overall E/O are binning-invariant (SDK values throughout).');
  L.push('');

  L.push('CONVENTIONS');
  L.push('-----------');
  L.push('  Non-finite values: CSV cells use the literal tokens NaN, Inf, -Inf (both pandas read_csv');
  L.push('    and R read.csv parse these as numeric). They are MEANINGFUL: time_of_onset = Inf marks a');
  L.push('    censored subject; study_rate = NaN marks an age with nobody at risk; a degenerate bin has');
  L.push('    expected_by_observed_ratio = NaN. In metrics.json / cohort-summary.json a non-finite number');
  L.push('    becomes null (JSON has no NaN/Inf) — the CSVs are authoritative for those cells.');
  L.push('');

  L.push('UNITS');
  L.push('-----');
  L.push('  Observed/predicted absolute risk and CIs: proportions in [0, 1] (the app shows percent).');
  L.push('  Relative risks: ratios, normalized to a cohort average of 1.');
  L.push('  Bin lo/hi (calibration-current-view.csv) and edges (metrics.json): in the binning scale —');
  L.push('    the raw linear predictor, or an absolute-risk PROPORTION (a "3%" cutpoint is stored as');
  L.push('    0.03). The cutpoints in metrics.json are in display units (percent on the absolute scale).');
  L.push('  Ages: years.');
  if (normalized.isNcc) {
    L.push('  weight (calibration-current-view.csv): Σ frequency (design weight) per bin.');
    L.push('  cohort-summary weighted.* rows: Horvitz–Thompson effective-cohort estimates (NCC only).');
  }
  L.push('');
  return L.join('\n');
}

/** Map text files under `data/`, figures under `figures/` (PNGs stored uncompressed), README at root. */
export function assembleEntries(
  texts: Record<string, string>,
  figures: RasterFigure[],
  readme: string,
): Zippable {
  const entries: Zippable = { 'README.txt': strToU8(readme) };
  for (const [name, text] of Object.entries(texts)) entries[`data/${name}`] = strToU8(text);
  for (const f of figures) {
    entries[`figures/${f.name}.svg`] = strToU8(f.svg);
    entries[`figures/${f.name}.png`] = [f.png, { level: 0 }]; // already compressed — store, don't deflate
  }
  return entries;
}

/** Deflate the entries into ZIP bytes (fixed mtime ⇒ reproducible archive). */
export function buildZip(entries: Zippable): Uint8Array {
  return zipSync(entries, { level: 6, mtime: ZIP_MTIME });
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

async function defaultRasterize(svg: SVGSVGElement, background?: string): Promise<Uint8Array> {
  const blob = await svgToPngBlob(svg, { background });
  return new Uint8Array(await blob.arrayBuffer());
}

export interface DownloadAllOptions extends ExportContext {
  /** Figures to bundle; defaults to the live results-figure registry. Injectable for tests. */
  figures?: { name: string; entry: FigureEntry }[];
  /** <svg> → PNG bytes; defaults to the canvas rasterizer. Injectable for tests (jsdom has no canvas). */
  rasterize?: (svg: SVGSVGElement, background?: string) => Promise<Uint8Array>;
  /** Export timestamp; defaults to now. Injectable for deterministic tests. */
  now?: Date;
}

/**
 * Collect the live figures + result files into one ZIP and trigger its download. Figures whose node is
 * not currently rendered (loading / empty / errored) are skipped and listed in the README. Resolves after
 * the download is triggered.
 */
export async function downloadAllZip(opts: DownloadAllOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const rasterize = opts.rasterize ?? defaultRasterize;
  const figureList = opts.figures ?? listResultsFigures();

  // Promise.all preserves input order, so rasterized figures stay in the registry's canonical order.
  const rastered = await Promise.all(
    figureList.map(async ({ name, entry }) => {
      const node = entry.getSvg();
      if (!node) return { name, figure: null as RasterFigure | null };
      const svg = svgToString(node);
      const png = await rasterize(node, entry.getBackground());
      return { name, figure: { name, svg, png } };
    }),
  );

  const figures: RasterFigure[] = [];
  const missing: string[] = [];
  for (const r of rastered) {
    if (r.figure) figures.push(r.figure);
    else missing.push(r.name);
  }

  const texts = collectResultFiles(
    opts.result,
    opts.normalized,
    opts.rc,
    opts.rebin,
    opts.defaultSpec,
    opts.provenance,
    now,
  );
  const readme = buildReadme(
    opts,
    Object.keys(texts),
    figures.map((f) => f.name),
    missing,
    now,
  );
  const zip = buildZip(assembleEntries(texts, figures, readme));

  const filename = `icare-validate-${slugify(opts.result.info.datasetName || 'validation')}-${stamp(now)}.zip`;
  downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), filename);
}
