import { SITE_ORIGIN } from '../aeoSurface';
import { GUIDES_ROOT, guidePath } from './index';
import type { Guide } from './types';

export const GUIDES_HUB_NAME = 'Материалы для кандидата';

type JsonLd = Record<string, unknown>;

const PUBLISHER: JsonLd = {
  '@type': 'Organization',
  name: 'openqareer',
  url: `${SITE_ORIGIN}/`,
};

export function guideBreadcrumbs(guide?: Guide): JsonLd {
  const items = [
    { name: 'Главная', item: `${SITE_ORIGIN}/` },
    { name: GUIDES_HUB_NAME, item: `${SITE_ORIGIN}${GUIDES_ROOT}` },
    ...(guide ? [{ name: guide.crumb, item: `${SITE_ORIGIN}${guidePath(guide.slug)}` }] : []),
  ];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((row, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      ...row,
    })),
  };
}

/** Article + BreadcrumbList + FAQPage: FAQ только из вопросов, напечатанных на странице. */
export function guideStructuredData(guide: Guide): JsonLd[] {
  const url = `${SITE_ORIGIN}${guidePath(guide.slug)}`;
  return [
    {
      '@type': 'Article',
      headline: guide.h1,
      description: guide.description,
      inLanguage: 'ru-RU',
      datePublished: guide.publishedAt,
      dateModified: guide.updatedAt,
      author: PUBLISHER,
      publisher: PUBLISHER,
      mainEntityOfPage: url,
      url,
      ...(guide.sources.length > 0 ? { citation: guide.sources.map((source) => source.url) } : {}),
    },
    guideBreadcrumbs(guide),
    {
      '@type': 'FAQPage',
      mainEntity: guide.faq.map((row) => ({
        '@type': 'Question',
        name: row.question,
        acceptedAnswer: { '@type': 'Answer', text: row.answer },
      })),
    },
  ];
}

export function guidesHubStructuredData(guides: readonly Guide[]): JsonLd[] {
  return [
    guideBreadcrumbs(),
    {
      '@type': 'CollectionPage',
      name: GUIDES_HUB_NAME,
      inLanguage: 'ru-RU',
      url: `${SITE_ORIGIN}${GUIDES_ROOT}`,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: guides.length,
        itemListElement: guides.map((guide, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${SITE_ORIGIN}${guidePath(guide.slug)}`,
          name: guide.h1,
        })),
      },
    },
  ];
}
