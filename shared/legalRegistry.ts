/**
 * Single source of truth for the published legal pack (B173).
 *
 * The pages under `/legal/<slug>`, the registration consent checkbox and the
 * consent record the server stores all read this module, so a document can
 * never be shown under one version and recorded under another.
 *
 * The pack is adapted from the owner's eterapy pack (documents 2–4 and 6),
 * same operator and same jurisdiction. Version stays `1.0` until the text is
 * actually re-issued: bumping it would invalidate every stored `versionId` and
 * require a re-acceptance flow.
 */
export const LEGAL_PACK_VERSION = '1.0';
export const LEGAL_PACK_PUBLISHED_AT = '2026-08-30';

/** What a consent record stores, so a record always names the exact text. */
export const LEGAL_PACK_VERSION_ID = `legal-v${LEGAL_PACK_VERSION}-${LEGAL_PACK_PUBLISHED_AT}`;

export type LegalDocSlug = 'terms' | 'privacy' | 'consent' | 'disclaimer';

export const LEGAL_DOC_SLUGS: readonly LegalDocSlug[] = [
  'terms',
  'privacy',
  'consent',
  'disclaimer',
];

export interface LegalDocMeta {
  readonly slug: LegalDocSlug;
  /** Page `<h1>` and document title. */
  readonly title: string;
  /** Short label for footers and the consent line. */
  readonly navLabel: string;
  /** One-line description for `<meta name="description">` and JSON-LD. */
  readonly description: string;
}

export const LEGAL_DOCS: readonly LegalDocMeta[] = [
  {
    slug: 'terms',
    title: 'Пользовательское соглашение',
    navLabel: 'Соглашение',
    description:
      'Правила доступа и использования OpenQareer: аккаунт, материалы кандидата, подключение площадок, ограничения и применимое право.',
  },
  {
    slug: 'privacy',
    title: 'Политика обработки персональных данных',
    navLabel: 'Персональные данные',
    description:
      'Какие данные кандидата обрабатывает OpenQareer, зачем, как долго они хранятся и какие права есть у субъекта данных.',
  },
  {
    slug: 'consent',
    title: 'Согласие на обработку персональных данных',
    navLabel: 'Согласие',
    description:
      'Текст согласия, которое кандидат принимает при регистрации в OpenQareer: состав данных, цели, срок действия и порядок отзыва.',
  },
  {
    slug: 'disclaimer',
    title: 'Дисклеймер',
    navLabel: 'Дисклеймер',
    description:
      'Границы сервиса OpenQareer: не кадровое агентство, не гарантия трудоустройства, не действие в аккаунтах кандидата без подтверждения.',
  },
];

function isLegalDocSlug(value: unknown): value is LegalDocSlug {
  return typeof value === 'string' && (LEGAL_DOC_SLUGS as readonly string[]).includes(value);
}

export function legalDocMeta(slug: LegalDocSlug): LegalDocMeta {
  return LEGAL_DOCS.find((doc) => doc.slug === slug)!;
}

export function legalPath(slug: LegalDocSlug): string {
  return `/legal/${slug}`;
}

/** `/legal/<slug>` and nothing else; a trailing slash is the same document. */
export function legalSlugFromPath(path: string): LegalDocSlug | undefined {
  const match = /^\/legal\/([a-z-]+)\/?$/.exec(path.split('?')[0] ?? '');
  const slug = match?.[1];
  return isLegalDocSlug(slug) ? slug : undefined;
}
