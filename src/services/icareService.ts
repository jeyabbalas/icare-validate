import { loadICARE } from 'wasm-icare';
// Vite compiles the SDK's module worker as a proper worker bundle (following its imports and
// applying `worker.format: 'es'`) and returns a base-aware URL string. Passing it as `workerUrl`
// bypasses the SDK's internal `new Worker(new URL('./worker.js', import.meta.url))`, whose hoisted
// URL can defeat Vite's static worker detection.
import icareWorkerUrl from 'wasm-icare/worker?worker&url';

import { PYICARE_WHEEL_FILENAME } from '../lib/icareTypes';
import { mapIcareError } from './mapIcareError';
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
      const message = mapIcareError(err);
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
    throw new Error(mapIcareError(err), { cause: err });
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

// `mapError` moved to ./mapIcareError (pure, worker-import-free) so it can be unit-tested without booting
// the SDK. Re-exported under the original name for call-site continuity.
export { mapIcareError as mapError } from './mapIcareError';
