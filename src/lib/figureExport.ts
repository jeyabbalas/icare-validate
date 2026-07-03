// Download a rendered figure as a standalone image. The figures in this app are Observable Plot
// output: a single, self-contained <svg> (we deliberately avoid Plot's title/caption/legend options,
// which wrap the result in an HTML <figure> that would not serialize into one image). Because the SVG
// carries only inline attributes and the system font stack — no external stylesheet, font, or image
// reference — it serializes losslessly to a string and rasterizes to a PNG with no canvas tainting.
//
// The one thing the caller must get right lives in the renderer, not here: Plot bakes
// `fill="currentColor"` into axes and text, so the renderer sets `style.color` to a resolved
// foreground color. That color is an inline style on the <svg>, so it travels with these exports and
// the image is faithful in both light and dark themes.
//
// Shared by every figure (this is the export half of the per-figure helpers the later viz phases reuse).

/** Serialize a live <svg> to a standalone XML string (clone first — never mutate the mounted node). */
export function svgToString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Trigger a browser download of `blob` as `filename` via a transient anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the in-flight download in some browsers; defer a tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The <svg>'s intrinsic pixel size — from the width/height attributes Plot always sets, else layout. */
function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  return {
    width: svg.width?.baseVal?.value || rect.width,
    height: svg.height?.baseVal?.value || rect.height,
  };
}

export interface PngOptions {
  /** Device-pixel multiplier for a crisp raster (default 2). */
  scale?: number;
  /** Solid backdrop painted under the figure. Omit/undefined ⇒ transparent. */
  background?: string;
}

/** Rasterize a self-contained <svg> to a PNG blob (hi-DPI, optional solid background). */
export async function svgToPngBlob(svg: SVGSVGElement, options: PngOptions = {}): Promise<Blob> {
  const { scale = 2, background } = options;
  const { width, height } = svgSize(svg);

  // A data: URL (not a blob: URL) with an explicit charset is the most cross-browser-robust source for
  // an <img>, and keeps the SVG inline so the canvas never taints.
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgToString(svg))}`;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode(); // rejects deterministically on a bad SVG; Safari-safe (no onload race)

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for PNG export.');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed.'))), 'image/png');
  });
}

/** Download the figure as a vector SVG (transparent background). */
export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  const blob = new Blob([svgToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

/** Download the figure as a raster PNG. Pass a `background` (e.g. the surface color) for a solid image. */
export async function downloadPng(
  svg: SVGSVGElement,
  filename: string,
  options: PngOptions = {},
): Promise<void> {
  const blob = await svgToPngBlob(svg, options);
  downloadBlob(blob, filename);
}
