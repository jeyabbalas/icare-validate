// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { svgToString } from './figureExport';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('svgToString', () => {
  function makeSvg(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '200');
    svg.setAttribute('height', '100');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '10');
    svg.appendChild(rect);
    return svg;
  }

  it('adds the SVG namespace and an XML declaration, preserving content', () => {
    const out = svgToString(makeSvg());
    expect(out).toMatch(/^<\?xml/);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('<rect');
    expect(out).toContain('width="200"');
  });

  it('does not mutate the live node (serializes a clone)', () => {
    const svg = makeSvg();
    svgToString(svg);
    // The live node must be untouched — the namespace attribute was added only to the clone.
    expect(svg.getAttribute('xmlns')).toBeNull();
  });
});
