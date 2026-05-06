/**
 * Bandeau coloré 5 segments fixé en haut de la landing.
 * - position: fixed (cf landing.css `.landing-color-band`)
 * - frère direct du wrapper data-scope="landing" pour éviter tout parent
 *   transform/filter/will-change qui casserait le fixed.
 */

export function ColorBand(): JSX.Element {
  return <div className="landing-color-band" aria-hidden="true" />;
}
