/**
 * B535: JSON-LD for the landing, /faq and /support. One organization and one
 * website node referenced by @id everywhere (SEO audit 20.10, 10/10). FAQPage
 * text equals the visible answers; the landing carries no FAQPage (its six
 * questions repeat /faq, and duplicated FAQ markup is discouraged).
 * `dateModified` is the date the page copy changed.
 */
import { TARIFF_LEVELS } from '../tariffs/tariffsData';
import { DESKTOP_DOWNLOAD_PATH } from './DesktopDownload';
import { LANDING_TITLE } from './siteTitles';
import { FAQ_TOPICS } from './faqPageContent';
import {
  LANDING_DESCRIPTION,
  ORG_ID,
  OPERATOR_TAX_ID,
  SITE_ORIGIN,
  SUPPORT_EMAIL,
  TELEGRAM_BOT_URL,
  TELEGRAM_COMMUNITY_URL,
  WEBSITE_ID,
} from './publicSiteContent';

type Node = Record<string, unknown>;

/** Last change of the public copy; bump together with the texts. */
export const PUBLIC_COPY_UPDATED_AT = '2026-10-20';

function question(item: { readonly question: string; readonly answer: string }): Node {
  return {
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  };
}

function webPage(path: string, name: string): Node {
  return {
    '@type': 'WebPage',
    '@id': `${SITE_ORIGIN}${path}#webpage`,
    url: `${SITE_ORIGIN}${path}`,
    name,
    inLanguage: 'ru-RU',
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORG_ID },
    dateModified: PUBLIC_COPY_UPDATED_AT,
  };
}

const ORGANIZATION: Node = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'openqareer',
  url: `${SITE_ORIGIN}/`,
  logo: `${SITE_ORIGIN}/logo.png`,
  email: SUPPORT_EMAIL,
  taxID: OPERATOR_TAX_ID,
  sameAs: [TELEGRAM_COMMUNITY_URL],
};

const WEBSITE: Node = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: `${SITE_ORIGIN}/`,
  name: 'openqareer',
  inLanguage: 'ru-RU',
  publisher: { '@id': ORG_ID },
};

function digits(price: string): number {
  return Number(price.replace(/\D/gu, ''));
}

function offers(): Node[] {
  return TARIFF_LEVELS.map((level) => {
    if (level.id === 'free') {
      return { '@type': 'Offer', name: level.name, price: '0', priceCurrency: 'RUB' };
    }
    if (level.id === 'exec') {
      return {
        '@type': 'Offer',
        name: level.name,
        priceSpecification: {
          '@type': 'PriceSpecification',
          minPrice: 150000,
          maxPrice: 300000,
          priceCurrency: 'RUB',
        },
      };
    }
    return {
      '@type': 'Offer',
      name: level.name,
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: digits(level.price),
        priceCurrency: 'RUB',
        billingDuration: 'P1M',
      },
    };
  });
}

export function landingStructuredData(): Node {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      WEBSITE,
      ORGANIZATION,
      {
        '@type': 'SoftwareApplication',
        name: 'openqareer',
        url: `${SITE_ORIGIN}/`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, macOS, Windows',
        inLanguage: 'ru-RU',
        description: LANDING_DESCRIPTION,
        publisher: { '@id': ORG_ID },
        softwareVersion: '1.0.0',
        downloadUrl: `${SITE_ORIGIN}${DESKTOP_DOWNLOAD_PATH}`,
        fileSize: '36.5MB',
        offers: offers(),
      },
      webPage('/', LANDING_TITLE),
    ],
  };
}

function breadcrumb(name: string, path: string): Node {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'openqareer', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name, item: `${SITE_ORIGIN}${path}` },
    ],
  };
}

export function faqStructuredData(): Node {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': `${SITE_ORIGIN}/faq#faqpage`,
        url: `${SITE_ORIGIN}/faq`,
        inLanguage: 'ru-RU',
        isPartOf: { '@id': WEBSITE_ID },
        publisher: { '@id': ORG_ID },
        dateModified: PUBLIC_COPY_UPDATED_AT,
        mainEntity: FAQ_TOPICS.flatMap((topic) => topic.items.map(question)),
      },
      breadcrumb('Вопросы и ответы', '/faq'),
    ],
  };
}

export function tariffsStructuredData(): Node {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'openqareer',
        url: `${SITE_ORIGIN}/tariffs`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, macOS, Windows',
        inLanguage: 'ru-RU',
        publisher: { '@id': ORG_ID },
        offers: offers(),
      },
      breadcrumb('Тарифы', '/tariffs'),
    ],
  };
}

export function supportStructuredData(): Node {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ContactPage',
        '@id': `${SITE_ORIGIN}/support#contact`,
        isPartOf: { '@id': WEBSITE_ID },
        inLanguage: 'ru-RU',
        name: 'Поддержка openqareer',
        url: `${SITE_ORIGIN}/support`,
        about: { '@id': ORG_ID },
        publisher: { '@id': ORG_ID },
        dateModified: PUBLIC_COPY_UPDATED_AT,
      },
      {
        ...ORGANIZATION,
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: SUPPORT_EMAIL,
          availableLanguage: 'ru',
          description: 'Поддержка отвечает в течение рабочего дня.',
          url: TELEGRAM_BOT_URL,
        },
      },
      breadcrumb('Поддержка', '/support'),
    ],
  };
}
