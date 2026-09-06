import { describe, expect, it } from 'vitest';
import { legalStructuredData } from './legalStructuredData';
import { LEGAL_DOCS } from '../../../shared/legalRegistry';

describe('микроразметка правовой страницы (B209)', () => {
  it('называет страницу и её место в навигации', () => {
    const graph = legalStructuredData('privacy')['@graph'];
    const page = graph.find((node) => node['@type'] === 'WebPage');
    const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList');

    expect(page).toMatchObject({
      url: 'https://openqareer.com/legal/privacy',
      inLanguage: 'ru-RU',
    });
    expect(crumbs).toMatchObject({
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'openqareer', item: 'https://openqareer.com/' },
        {
          '@type': 'ListItem',
          position: 2,
          item: 'https://openqareer.com/legal/privacy',
        },
      ],
    });
  });

  it('строит разметку для каждого опубликованного документа', () => {
    for (const doc of LEGAL_DOCS) {
      const data = legalStructuredData(doc.slug);
      expect(data['@context']).toBe('https://schema.org');
      expect(JSON.stringify(data)).toContain(doc.title);
    }
  });
});
