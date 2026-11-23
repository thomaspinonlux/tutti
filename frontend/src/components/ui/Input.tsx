/**
 * <Input /> — champ texte Pop Cocktail.
 * Fond cream/30, bordure ink épaisse, focus ring spritz.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /**
   * Variante sombre (console iPad / TV) : verre #181628, bordure white/10,
   * texte blanc, focus ring coral. Défaut = thème clair Pop Cocktail.
   */
  dark?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className, id, dark, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  const base = 'w-full px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2';
  const theme = dark
    ? 'bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:bg-cream-3/[0.09] focus:ring-[#00F0FF]'
    : 'bg-cream-2 border-hairline text-ink focus:bg-cream-3 focus:border-spritz focus:ring-spritz/40 placeholder:text-ink-faded';
  const errorBorder = error ? (dark ? 'border-[#FF3366]' : 'border-raspberry') : '';
  return (
    <label className="block">
      {label && (
        <span
          className={`block text-xs font-mono uppercase tracking-wider mb-1 ${
            dark ? 'text-white/50' : 'text-ink/70'
          }`}
        >
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={`${base} ${theme} ${errorBorder} ${className ?? ''}`}
        {...rest}
      />
      {hint && !error && (
        <span className={`block text-xs mt-1 italic ${dark ? 'text-white/40' : 'text-ink-soft'}`}>
          {hint}
        </span>
      )}
      {error && (
        <span
          role="alert"
          className={`block text-xs mt-1 font-medium ${dark ? 'text-[#FF3366]' : 'text-raspberry'}`}
        >
          {error}
        </span>
      )}
    </label>
  );
});
