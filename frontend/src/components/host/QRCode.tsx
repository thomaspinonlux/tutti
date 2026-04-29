/**
 * <QRCode value=... /> — génère un SVG QR code via la lib `qrcode`.
 * Pas d'aller-retour réseau, rendu côté client.
 */

import { useEffect, useState } from 'react';
import QR from 'qrcode';

interface Props {
  value: string;
  size?: number;
  className?: string;
}

export function QRCode({ value, size = 240, className }: Props): JSX.Element {
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void QR.toString(value, {
      type: 'svg',
      margin: 2,
      width: size,
      color: { dark: '#1a1410', light: '#f5ecd9' },
      errorCorrectionLevel: 'M',
    }).then((s) => {
      if (!cancelled) setSvg(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className={`inline-block border-3 border-ink rounded-lg p-3 bg-cream shadow-pop-lg ${className ?? ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label={`QR code pour ${value}`}
    />
  );
}
