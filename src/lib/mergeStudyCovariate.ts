import { csvFormat } from 'd3-dsv';
import type { ParsedTable } from './csvIngest';

// Merge a study-data table with its covariate profile into ONE display table, linked by ROW POSITION.
//
// This mirrors exactly how py-icare pairs the two inputs during validation: `ModelValidation` feeds one
// apply-age per study row, computes risks over the separate covariate profile, then writes them back
// with pandas `.values` — i.e. positionally (row i of the profile ↔ row i of the study). iCARE enforces
// equal row counts (`utils.set_age_intervals` raises otherwise) and never joins on `id`. So we merge by
// index, not by key; a mismatched `id` sequence is surfaced as a warning but does NOT change the
// (positional) pairing — that would diverge from what the SDK actually computes.
//
// Clean-union columns: all study columns in order, then every covariate column that is not already a
// study column — and never the covariate's own `id` (py-icare ignores it, and a second `id` column would
// mislead). This is purely a preview: the raw Files sent to the SDK are untouched.

export interface MergeResult {
  /** Serialized merged table (study columns ++ appended covariate columns), ready to hand to DuckDB. */
  csv: string;
  /** Merged column order. */
  columns: string[];
  /** Merged rows (string-valued, as parsed); row i = study row i + the appended covariate cells. */
  rows: Record<string, string>[];
  /** Covariate columns that were appended (present in the profile, absent from the study; excludes `id`). */
  appendedColumns: string[];
  /** Covariate columns skipped because the study already has them (excludes `id`). */
  foldedColumns: string[];
  /** True when both tables carry an `id` column but the values don't line up positionally. */
  idOrderMismatch: boolean;
}

const ID = 'id';

/**
 * Positionally merge `study` and `covariate` (clean union). Rows pair by index. Callers should merge
 * only when the two have equal row counts (py-icare's own precondition); if they differ we still produce
 * a table over the shorter length so nothing throws, but the caller is expected to fall back to separate
 * tables in that case rather than present a misaligned merge.
 */
export function mergeStudyCovariate(study: ParsedTable, covariate: ParsedTable): MergeResult {
  const studyCols = study.headers;
  const studySet = new Set(studyCols);

  const appendedColumns: string[] = [];
  const foldedColumns: string[] = [];
  for (const col of covariate.headers) {
    if (col === ID) continue; // the profile's id is never a linking key and is dropped from the merge
    if (studySet.has(col)) foldedColumns.push(col);
    else appendedColumns.push(col);
  }

  const columns = [...studyCols, ...appendedColumns];
  const n = Math.min(study.rows.length, covariate.rows.length);
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const srow = study.rows[i];
    const crow = covariate.rows[i];
    const row: Record<string, string> = {};
    for (const col of studyCols) row[col] = srow[col] ?? '';
    for (const col of appendedColumns) row[col] = crow[col] ?? '';
    rows.push(row);
  }

  return {
    csv: csvFormat(rows, columns),
    columns,
    rows,
    appendedColumns,
    foldedColumns,
    idOrderMismatch: detectIdOrderMismatch(study, covariate, n),
  };
}

/** Both carry an `id` column and at least one position disagrees → the files aren't in the same order. */
function detectIdOrderMismatch(study: ParsedTable, covariate: ParsedTable, n: number): boolean {
  if (!study.headers.includes(ID) || !covariate.headers.includes(ID)) return false;
  for (let i = 0; i < n; i++) {
    if (study.rows[i][ID] !== covariate.rows[i][ID]) return true;
  }
  return false;
}
