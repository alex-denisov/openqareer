/**
 * Микроразметка правовой страницы (B173, крошки — B209).
 *
 * Правовой документ — самостоятельная индексируемая страница, поэтому она
 * называет и себя (`WebPage`), и своё место в навигации (`BreadcrumbList`):
 * без крошек поисковик показывает голый адрес вместо пути внутри сайта.
 */
import {
  LEGAL_PACK_PUBLISHED_AT,
  LEGAL_PACK_VERSION,
  legalDocMeta,
  legalPath,
  type LegalDocSlug,
} from '../../../shared/legalRegistry';
import { SITE_ORIGIN } from '../../../shared/aeoSurface';

export interface StructuredDataNode {
  readonly '@type': string;
  readonly [key: string]: unknown;
}

export interface StructuredDataGraph {
  readonly '@context': 'https://schema.org';
  readonly '@graph': readonly StructuredDataNode[];
}

export function legalStructuredData(slug: LegalDocSlug): StructuredDataGraph {
  const meta = legalDocMeta(slug);
  const url = `${SITE_ORIGIN}${legalPath(slug)}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: meta.title,
        description: meta.description,
        url,
        inLanguage: 'ru-RU',
        datePublished: LEGAL_PACK_PUBLISHED_AT,
        version: LEGAL_PACK_VERSION,
        isPartOf: { '@type': 'WebSite', name: 'OpenQareer', url: `${SITE_ORIGIN}/` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'openqareer', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: meta.title, item: url },
        ],
      },
    ],
  };
}
