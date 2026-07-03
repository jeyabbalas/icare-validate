// Build-time no-op stub for @jeyabbalas/data-table's optional CodeMirror peers.
//
// data-table@0.5.x always emits a `CodeMirrorExpressionEditor` chunk (used by its raw-SQL filter and
// derived-column editor). We keep BOTH features disabled (see DataTablePanel: expressionFilter/
// derivedColumns = false), so that chunk is never loaded at runtime — but the bundler still has to
// BUILD it, which requires its @codemirror/* and @lezer/highlight imports to resolve. Rather than
// install those 7 peer packages for code that never runs, vite.config.ts aliases them all to this
// module. It only needs to expose the exact named bindings the editor chunk imports so the bundler's
// export check passes; the values are never evaluated (the chunk is never fetched).
//
// If a future data-table version imports new CodeMirror symbols, the build fails loudly with a
// MISSING_EXPORT — add the missing name here. To actually USE the SQL editor / derived columns,
// remove the aliases in vite.config.ts, install the @codemirror/* + @lezer/highlight peers, and flip
// the expressionFilter / derivedColumns flags in DataTablePanel.
const stub = undefined;

export const autocompletion = stub; // @codemirror/autocomplete
export const defaultKeymap = stub; // @codemirror/commands
export const history = stub;
export const historyKeymap = stub;
export const Compartment = stub; // @codemirror/state
export const EditorState = stub;
export const EditorView = stub; // @codemirror/view
export const keymap = stub;
export const placeholder = stub;
export const PostgreSQL = stub; // @codemirror/lang-sql
export const sql = stub;
export const HighlightStyle = stub; // @codemirror/language
export const syntaxHighlighting = stub;
export const tags = stub; // @lezer/highlight
