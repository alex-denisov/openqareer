/**
 * Автор публичных материалов (GEO 09.11): страница `/authors/alexey-denisov`,
 * подпись статей и `author` в разметке Article ссылаются сюда.
 *
 * ФОТО — ОДИН ИСТОЧНИК. Снимок не лежит в репозитории: `AUTHOR_PHOTO_PATH`
 * отдаёт сервер из текущего фото профиля аккаунта `AUTHOR_ACCOUNT`
 * (`resume_drafts` → `candidate_media`). Обновил фото в профиле — оно сменилось
 * на странице автора, в подписях и в разметке сразу.
 *
 * Факты карьеры взяты из профиля аккаунта на платформе (импорт LinkedIn),
 * сверены 09.11.2026. Цифр достижений здесь нет: у них нет внешнего источника.
 */
import { SITE_ORIGIN } from './siteOrigin';

export const AUTHOR_SLUG = 'alexey-denisov';
export const AUTHORS_ROOT = '/authors';
export const AUTHOR_PATH = `${AUTHORS_ROOT}/${AUTHOR_SLUG}`;
export const AUTHOR_PHOTO_PATH = `${AUTHOR_PATH}/photo`;
/** Логин владельца; фото читается из профиля этого аккаунта. */
export const AUTHOR_ACCOUNT = 'adenisov.test';

export interface AuthorRole {
  readonly title: string;
  readonly employer: string;
  /** Без года — роль без даты в профиле. */
  readonly from?: string;
  readonly to?: string;
}

export const AUTHOR = {
  nameRu: 'Алексей Денисов',
  nameEn: 'Alexey Denisov',
  jobTitle: 'CEO',
  jobTitleRu: 'CEO openqareer',
  linkedin: 'https://www.linkedin.com/in/alexeydenisov/',
  location: 'Дубай, ОАЭ',
  checkedAt: '2026-11-09',
  lead:
    'CEO openqareer. Больше 15 лет руководит ИТ, облачной инфраструктурой, технической поддержкой ' +
    'и операционной работой — в найме и в собственной компании.',
  roles: [
    { title: 'CEO', employer: 'openqareer' },
    {
      title: 'Независимый консультант по ИИ и архитектор решений',
      employer: 'OptiLab AI',
      from: '2025',
    },
    {
      title: 'VP of Technology & IT Operations',
      employer: 'Enterprise Energy IT Services',
      from: '2023',
      to: '2025',
    },
    {
      title: 'Руководитель технической поддержки и внутренних сервисов',
      employer: 'Публичная облачная платформа (IaaS / PaaS)',
      from: '2020',
      to: '2023',
    },
    {
      title: 'Сооснователь и COO',
      employer: 'Fishance Berhad, Малайзия',
      from: '2016',
      to: '2019',
    },
    {
      title: 'ИТ-лид (и. о. руководителя ИТ)',
      employer: 'Корпоративный университет крупного финансового института',
      from: '2012',
      to: '2016',
    },
    {
      title: 'Руководитель премиальной поддержки',
      employer: 'Kaspersky',
      from: '2010',
      to: '2012',
    },
  ] satisfies readonly AuthorRole[],
  education: [
    'Технический университет Молдовы — бакалавр инженерии, информационные технологии (2005–2010)',
    'GeekBrains — профессиональная программа DevOps Engineering (2021–2023)',
  ],
  languages: ['русский — родной', 'английский — C1'],
} as const;

export const AUTHOR_URL = `${SITE_ORIGIN}${AUTHOR_PATH}`;
export const AUTHOR_PHOTO_URL = `${SITE_ORIGIN}${AUTHOR_PHOTO_PATH}`;
export const AUTHOR_ID = `${AUTHOR_URL}#person`;

type JsonLd = Record<string, unknown>;

/** Короткая ссылка на автора: в Article и подписи. */
export function authorReference(): JsonLd {
  return {
    '@type': 'Person',
    '@id': AUTHOR_ID,
    name: AUTHOR.nameRu,
    url: AUTHOR_URL,
    image: AUTHOR_PHOTO_URL,
  };
}

/** Полная разметка Person — на странице автора. */
export function authorPerson(): JsonLd {
  return {
    '@type': 'Person',
    '@id': AUTHOR_ID,
    name: AUTHOR.nameRu,
    alternateName: AUTHOR.nameEn,
    jobTitle: AUTHOR.jobTitle,
    description: AUTHOR.lead,
    image: AUTHOR_PHOTO_URL,
    url: AUTHOR_URL,
    worksFor: { '@type': 'Organization', name: 'openqareer', url: `${SITE_ORIGIN}/` },
    sameAs: [AUTHOR.linkedin],
    knowsLanguage: ['ru', 'en'],
  };
}
