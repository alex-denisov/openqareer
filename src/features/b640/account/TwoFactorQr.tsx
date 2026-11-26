import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * QR ссылки otpauth для приложения-аутентификатора. Матрица строится здесь же (uqr, без сети
 * и без зависимостей) и рисуется прямоугольниками SVG: секрет никуда не уходит.
 */
export function TwoFactorQr({ value }: { readonly value: string }) {
  const { size, path } = useMemo(() => {
    const { data } = encode(value, { border: 2, ecc: 'M' });
    const cells = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join('');
    return { size: data.length, path: cells };
  }, [value]);
  return (
    <svg
      className="fa-qr"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR-код для приложения-аутентификатора"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}
