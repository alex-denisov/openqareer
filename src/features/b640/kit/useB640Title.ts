import { useEffect } from 'react';
import { useScreenActive } from './screenActive';

/** Вкладка браузера называет раздел кабинета: «Аккаунт · openqareer» (B772). */
export function b640Title(section: string): string {
  return `${section} · openqareer`;
}

/** Ставит заголовок вкладки, пока раздел открыт. */
export function useB640Title(section: string): void {
  const active = useScreenActive();
  useEffect(() => {
    if (active) document.title = b640Title(section);
  }, [section, active]);
}
