// Keyboard navigation for an ARIA tablist. Attach `tabListKeyDown` to the tablist container's onKeyDown:
// Arrow keys (and Home/End) move focus among the container's `[role="tab"]` children and activate the
// focused tab (the "automatic activation" pattern — selection follows focus). It queries the DOM for the
// tabs rather than taking refs, so it works with both raw <button> and <Button>-based tabs. Pair it with a
// roving tabIndex (the selected tab tabIndex=0, the rest -1) so Tab enters/leaves the tablist as one stop.

import type { KeyboardEvent } from 'react';

const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];

export function tabListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (!NAV_KEYS.includes(e.key)) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (tabs.length === 0) return;
  const current = tabs.findIndex((t) => t === document.activeElement);
  if (current < 0) return;
  e.preventDefault();
  const n = tabs.length;
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? n - 1
        : e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? (current + 1) % n
          : (current - 1 + n) % n;
  const el = tabs[next];
  el.focus();
  el.click(); // activation follows focus; the tab's own onClick updates the selection
}
