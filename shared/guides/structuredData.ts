import { SITE_ORIGIN } from '../siteOrigin';
import { authorReference } from '../author';
import { GUIDES_COLLECTION, collectionPath, type GuideCollection } from './collection';
import type { Guide } from './types';

export const GUIDES_HUB_NAME = GUIDES_COLLECTION.hubName;

type JsonLd = Record<string, unknown>;

const PUBLISHER: JsonLd = {
  '@type': 'Organization',
  name: 'openqareer',
  url: `${SITE_ORIGIN}/`,
};

export function guideBreadcrumbs(
  guide?: Guide,
  collection: GuideCollection = GUIDES_COLLECTION,
): JsonLd {
  const items = [
    { name: 'Главная', item: `${SITE_ORIGIN}/` },
    { name: collection.hubName, item: `${SITE_ORIGIN}${collection.root}` },
    ...(guide
      ? [{ name: guide.crumb, item: `${SITE_ORIGIN}${collectionPath(collection, guide.slug)}` }]
      : []),
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
export function guideStructuredData(
  guide: Guide,
  collection: GuideCollection = GUIDES_COLLECTION,
): JsonLd[] {
  const url = `${SITE_ORIGIN}${collectionPath(collection, guide.slug)}`;
  return [
    {
      '@type': 'Article',
      headline: guide.h1,
      description: guide.description,
      inLanguage: 'ru-RU',
      datePublished: guide.publishedAt,
      dateModified: guide.updatedAt,
      author: authorReference(),
      publisher: PUBLISHER,
      mainEntityOfPage: url,
      url,
      ...(guide.short ? { abstract: guide.short.text } : {}),
      ...(guide.sources.length > 0 ? { citation: guide.sources.map((source) => source.url) } : {}),
    },
    guideBreadcrumbs(guide, collection),
    ...(guide.faq.length === 0
      ? []
      : [
          {
            '@type': 'FAQPage',
            mainEntity: guide.faq.map((row) => ({
              '@type': 'Question',
              name: row.question,
              acceptedAnswer: { '@type': 'Answer', text: row.answer },
            })),
          },
        ]),
  ];
}

export function guidesHubStructuredData(
  guides: readonly Guide[],
  collection: GuideCollection = GUIDES_COLLECTION,
): JsonLd[] {
  return [
    guideBreadcrumbs(undefined, collection),
    {
      '@type': 'CollectionPage',
      name: collection.hubName,
      inLanguage: 'ru-RU',
      url: `${SITE_ORIGIN}${collection.root}`,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: guides.length,
        itemListElement: guides.map((guide, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${SITE_ORIGIN}${collectionPath(collection, guide.slug)}`,
          name: guide.h1,
        })),
      },
    },
  ];
}
