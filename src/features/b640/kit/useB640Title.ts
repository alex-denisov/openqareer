import { useEffect } from 'react';

/** Вкладка браузера называет раздел кабинета: «Аккаунт · openqareer» (B772). */
export function b640Title(section: string): string {
  return `${section} · openqareer`;
}

/** Ставит заголовок вкладки, пока раздел открыт. */
export function useB640Title(section: string): void {
  useEffect(() => {
    document.title = b640Title(section);
  }, [section]);
}
