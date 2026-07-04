// Shared indeterminate spinner — wraps the global `.icv-spinner` class (keyframes live in index.css and
// honor prefers-reduced-motion). The SDK exposes no boot/compute progress, so all progress is indeterminate.

interface SpinnerProps {
  /** Accessible label announced to assistive tech via role="status". */
  label?: string;
}

export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return <div className="icv-spinner" role="status" aria-label={label} />;
}
