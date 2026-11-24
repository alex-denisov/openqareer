import type { SectionProps } from '../sections';
import { useB640Title } from '../kit/useB640Title';

/**
 * Раздел «Консультант» — панель, а не страница: её ставит оболочка рядом с `main`
 * (`shell/ConsultantDock`), и над адресами k01 и k05 тоже. Своей страницы у раздела нет.
 */
export default function Section(_props: SectionProps) {
  useB640Title('Консультант');
  return null;
}
