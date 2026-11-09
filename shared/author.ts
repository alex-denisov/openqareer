/**
 * Автор материалов: карточка в статьях /blog и /guides и `author` в разметке
 * Article. Отдельной страницы автора нет (решение владельца 09.11): только
 * имя, должность, фото и ссылка на LinkedIn, без биографии.
 *
 * ФОТО — ОДИН ИСТОЧНИК. Снимок не лежит в репозитории: `AUTHOR_PHOTO_PATH`
 * отдаёт сервер из текущего фото профиля аккаунта `AUTHOR_ACCOUNT`.
 */
import { SITE_ORIGIN } from './siteOrigin';

export const AUTHOR_PHOTO_PATH = '/authors/alexey-denisov/photo';
/** Бывшая страница автора; отвечает 301 на главную. */
export const RETIRED_AUTHOR_PATH = '/authors/alexey-denisov';
/** Логин владельца; фото читается из профиля этого аккаунта. */
export const AUTHOR_ACCOUNT = 'adenisov.test';

export const AUTHOR = {
  name: 'Алексей Денисов',
  jobTitle: 'CEO openqareer',
  note: 'Отвечает за то, что openqareer пишет кандидатам.',
  linkedin: 'https://www.linkedin.com/in/alexeydenisov/',
} as const;

export const AUTHOR_PHOTO_URL = `${SITE_ORIGIN}${AUTHOR_PHOTO_PATH}`;

/** Person для `author` / `creator`: имя, должность, фото, LinkedIn, сайт. */
export function authorReference(): Record<string, unknown> {
  return {
    '@type': 'Person',
    name: AUTHOR.name,
    jobTitle: AUTHOR.jobTitle,
    image: AUTHOR_PHOTO_URL,
    sameAs: [AUTHOR.linkedin],
    url: `${SITE_ORIGIN}/`,
  };
}
