/**
 * <Input /> — champ texte Pop Cocktail.
 * Fond cream/30, bordure ink épaisse, focus ring spritz.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <label className="block">
      {label && (
        <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={`w-full px-3 py-2 border-2 border-ink rounded bg-cream/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz placeholder:text-ink-faded ${error ? 'border-raspberry' : ''} ${className ?? ''}`}
        {...rest}
      />
      {hint && !error && <span className="block text-xs text-ink-soft mt-1 italic">{hint}</span>}
      {error && (
        <span role="alert" className="block text-xs text-raspberry mt-1 font-medium">
          {error}
        </span>
      )}
    </label>
  );
});
