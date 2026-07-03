import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { InputBuilder } from './InputBuilder';

// A crash-only smoke test: renders the whole input builder to static markup so a runtime React
// error (bad hook usage, undefined selector) fails CI without needing a browser. It does not assert
// on interactions — those are verified manually in the app.
describe('InputBuilder', () => {
  it('renders without crashing and shows the key controls', () => {
    const html = renderToStaticMarkup(createElement(InputBuilder));
    expect(html).toContain('Load example');
    expect(html).toContain('iCARE-Lit (ge50)');
    expect(html).toContain('iCARE-Lit (lt50)');
    expect(html).toContain('BPC3');
    expect(html).toContain('Validation mode');
    expect(html).toContain('Input summary');
    expect(html).toContain('Study data');
  });
});
