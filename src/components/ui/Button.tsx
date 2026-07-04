// Shared button primitive. Three variants cover the app's button idioms — the accent-filled primary CTA,
// the surface-tone secondary/link button, and the small segmented toggle — each carrying the app's disabled
// convention. Extracted to retire the copies hand-rolled across RunActionBar, ResultsPanel, Stepper, and
// the toggles. Call sites can still tune padding/width via `style` (merged last). Component-only export
// (the `ButtonVariant` type is erased at build), so it doesn't trip react-refresh.

export type ButtonVariant = 'primary' | 'secondary' | 'toggle';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Active state for the `toggle` variant (accent fill when set). */
  active?: boolean;
}

const baseStyle: React.CSSProperties = {
  borderRadius: 'var(--app-radius)',
  fontWeight: 600,
  cursor: 'pointer',
};

function variantStyle(
  variant: ButtonVariant,
  disabled: boolean,
  active: boolean,
): React.CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        border: '1px solid var(--app-accent)',
        background: disabled ? 'var(--app-surface)' : 'var(--app-accent)',
        color: disabled ? 'var(--app-muted)' : 'var(--app-accent-fg)',
        padding: '10px 14px',
        fontWeight: 700,
      };
    case 'toggle':
      return {
        border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
        background: active ? 'var(--app-accent)' : 'var(--app-surface-2)',
        color: active ? 'var(--app-accent-fg)' : 'var(--app-fg)',
        padding: '4px 8px',
        fontSize: 12,
      };
    default:
      return {
        border: '1px solid var(--app-border)',
        background: 'var(--app-surface-2)',
        color: 'var(--app-fg)',
        padding: '8px 12px',
      };
  }
}

export function Button({
  variant = 'secondary',
  active = false,
  disabled = false,
  type = 'button',
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      style={{
        ...baseStyle,
        ...variantStyle(variant, disabled, active),
        // Primary keeps its muted surface fill when disabled; the others just dim.
        ...(disabled ? { cursor: 'not-allowed', ...(variant === 'primary' ? null : { opacity: 0.6 }) } : null),
        ...style,
      }}
      {...rest}
    />
  );
}
