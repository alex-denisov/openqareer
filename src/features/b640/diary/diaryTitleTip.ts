import type { B640Node } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';

/** Текст ⓘ у заголовка «Дневник» — дословно из макета (п. 97, `data-title-tip`). */
export const DIARY_TITLE_TIP = 'Дневник виден только вам: работодатель его не видит.';

/** ⓘ «Кто видит» на экранах с заголовком «Дневник» (дневник и адаптация). */
export function useDiaryTitleTip(node: B640Node): void {
  useScreenChrome(node.title === 'Дневник' ? { titleTip: DIARY_TITLE_TIP } : {});
}
