import { loadICARE } from 'wasm-icare';
// Vite compiles the SDK's module worker as a proper worker bundle (following its imports and
// applying `worker.format: 'es'`) and returns a base-aware URL string. Passing it as `workerUrl`
// bypasses the SDK's internal `new Worker(new URL('./worker.js', import.meta.url))`, whose hoisted
// URL can defeat Vite's static worker detection.
import icareWorkerUrl from 'wasm-icare/worker?worker&url';

import { PYICARE_WHEEL_FILENAME } from '../lib/icareTypes';
import type {
  ICARE,
  LoadICAREOptions,
  ValidateAbsoluteRiskModelOptions,
  ValidationResult,
} from '../lib/icareTypes';

// Must appear literally so Vite statically replaces it: "/icare-validate/" in prod, "/" in dev.
const BASE = import.meta.env.BASE_URL;

export type IcareStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface IcareServiceState {
  status: IcareStatus;
  error: string | null;
}

type Listener = (state: IcareServiceState) => void;

let icarePromise: Promise<ICARE> | null = null;
let instance: ICARE | null = null;
let state: IcareServiceState = { status: 'idle', error: null };
const listeners = new Set<Listener>();

function emit(patch: Partial<IcareServiceState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

/** Subscribe to engine status changes. Fires immediately with the current state. Returns unsubscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): IcareServiceState {
  return state;
}

function buildLoadOptions(): LoadICAREOptions {
  return {
    offline: true, // fully self-hosted — no jsDelivr fallback
    indexURL: `${BASE}pyodide/`,
    pyicareWheelUrl: `${BASE}pyodide/${PYICARE_WHEEL_FILENAME}`,
    useWorker: true,
    workerUrl: icareWorkerUrl,
  };
}

/**
 * Lazily boot the iCARE engine, memoizing the promise so concurrent callers share one Pyodide
 * worker. Nothing loads until this (or `validate`) is first called. The SDK exposes no progress
 * events, so `status` is coarse: `'loading'` spans the whole multi-second boot.
 */
export function ensureLoaded(): Promise<ICARE> {
  if (icarePromise) return icarePromise;

  emit({ status: 'loading', error: null });

  icarePromise = loadICARE(buildLoadOptions())
    .then((icare) => {
      instance = icare;
      emit({ status: 'ready', error: null });
      return icare;
    })
    .catch((err: unknown) => {
      icarePromise = null; // allow a retry after failure
      instance = null;
      const message = mapError(err);
      emit({ status: 'error', error: message });
      throw new Error(message, { cause: err });
    });

  return icarePromise;
}

/** Alias kept for call-site readability. */
export const getICARE = ensureLoaded;

/** Run one absolute-risk model validation. Boots the engine on first use. */
export async function validate(
  options: ValidateAbsoluteRiskModelOptions,
): Promise<ValidationResult> {
  const icare = await ensureLoaded();
  try {
    return await icare.validateAbsoluteRiskModel(options);
  } catch (err) {
    throw new Error(mapError(err), { cause: err });
  }
}

/** Terminate the worker (the SDK disposer is `close()`, not `dispose()`) and reset the singleton. */
export async function dispose(): Promise<void> {
  const current = instance;
  icarePromise = null;
  instance = null;
  emit({ status: 'idle', error: null });
  if (current) {
    try {
      await current.close();
    } catch {
      /* already torn down */
    }
  }
}

/** Map known SDK error strings to friendly messages; fall back to the raw text. */
export function mapError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/is not implemented yet/i.test(raw)) {
    return 'Internal build error: a non-browser iCARE build was loaded. Vite is not resolving the wasm-icare "browser" export condition.';
  }
  if (/offline browser boot requires an explicit indexURL/i.test(raw)) {
    return 'Runtime assets missing (no Pyodide indexURL). Run "npm run vendor" to populate public/pyodide, then reload.';
  }
  if (/offline browser boot requires an explicit.*pyicareWheelUrl/i.test(raw)) {
    return 'Runtime assets missing (no pyicare wheel). Run "npm run vendor" to populate public/pyodide, then reload.';
  }
  if (/ICARE engine is closed/i.test(raw)) {
    return 'The iCARE engine was closed. Reload the page to start a new session.';
  }
  if (/failed to fetch '.+':\s*\d+/i.test(raw)) {
    return `A required runtime asset could not be loaded (offline cache miss or a missing vendored file). ${raw}`;
  }
  if (/browser cannot read/i.test(raw)) {
    return 'File paths are not supported in the browser. Provide each input as a URL or an uploaded file.';
  }

  return raw || 'Unknown error while running the iCARE engine.';
}
