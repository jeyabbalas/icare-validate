// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// The global error boundary: passes children through normally, and on a render-time throw shows a
// recoverable role=alert fallback (message + Reload) instead of a blank page.

let container: HTMLDivElement;

function Boom(): never {
  throw new Error('kaboom');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    const root = createRoot(container);
    act(() => root.render(createElement(ErrorBoundary, null, createElement('span', null, 'ok'))));
    expect(container.textContent).toContain('ok');
    act(() => root.unmount());
  });

  it('shows a recoverable fallback when a child throws', () => {
    // React logs the caught error (plus componentDidCatch); silence it for clean output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = createRoot(container);
    act(() => root.render(createElement(ErrorBoundary, null, createElement(Boom))));

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Something went wrong');
    expect(alert?.textContent).toContain('kaboom');
    expect(
      [...container.querySelectorAll('button')].some((b) => /reload/i.test(b.textContent ?? '')),
    ).toBe(true);

    act(() => root.unmount());
    spy.mockRestore();
  });
});
