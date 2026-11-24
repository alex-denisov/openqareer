import type { ResumeDraft } from '../../resume/resumeTypes';

/** Потолки ссылок профиля, как на сервере (`contact.links`). */
export const LINK_MAX = 500;
const LINKS_MAX = 20;

/** Адрес страницы: без протокола добавляем https, не адрес — `null`. */
export function normalizeLink(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/u.test(value)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!/[^.]\.[^.]*\p{L}[^.]*$/u.test(url.hostname)) return null;
    url.hash = '';
    return url.href.length <= LINK_MAX ? url.href : null;
  } catch {
    return null;
  }
}

const fold = (link: string): string => (normalizeLink(link) ?? link).replace(/\/$/u, '');

/** Профиль с новой ссылкой последней; повтор и лишняя ссылка ничего не меняют. */
export function withLink(draft: ResumeDraft, link: string): ResumeDraft {
  const contact = draft.candidate.contact;
  const links = contact?.links ?? [];
  if (links.length >= LINKS_MAX || links.some((item) => fold(item) === fold(link))) return draft;
  return {
    ...draft,
    candidate: { ...draft.candidate, contact: { ...contact, links: [...links, link] } },
  };
}

/** Места под ссылку не осталось, и такой ссылки ещё нет. */
export function linksFull(draft: ResumeDraft, link: string): boolean {
  const links = draft.candidate.contact?.links ?? [];
  return links.length >= LINKS_MAX && !links.some((item) => fold(item) === fold(link));
}
