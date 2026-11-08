import { CANT_FIND_A_JOB } from './cantFindAJob';
import { COVER_LETTER } from './coverLetter';
import { HOW_TO_WRITE_A_RESUME } from './howToWriteAResume';
import type { Guide } from './types';

export type * from './types';

/** B616: опорные материалы живут под одним корнем — будущий блог расширяет его. */
export const GUIDES_ROOT = '/guides';

export const GUIDES: readonly Guide[] = [CANT_FIND_A_JOB, COVER_LETTER, HOW_TO_WRITE_A_RESUME];

export function guidePath(slug: string): string {
  return `${GUIDES_ROOT}/${slug}`;
}

export function findGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

/** Ссылка «Читайте также»: слаг материала или путь сайта. */
export function relatedHref(entry: string): string {
  return entry.startsWith('/') ? entry : guidePath(entry);
}
