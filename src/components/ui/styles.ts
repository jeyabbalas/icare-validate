// Shared layout style tokens for the components layer (the ui counterpart of viz/chartChrome.ts). Kept a
// pure .ts module — no component exports — so it can co-live with constants without tripping react-refresh.

import type { CSSProperties } from 'react';

/** A flex-wrap row for a panel's metric tiles, shared so the three results panels space them identically. */
export const metricRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };
