import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaqPage } from './FaqPage';
import { TariffsPage } from './TariffsPage';
import { FAQ_TOPICS } from './faqPageContent';
import { faqStructuredData, tariffsStructuredData } from './publicSiteStructuredData';

const noop = () => {};

describe('/faq page', () => {
  const html = renderToStaticMarkup(<FaqPage onNavigate={noop} />);

  it('shows 48 questions in eight topics with the first answer of each open on desktop', () => {
    expect(FAQ_TOPICS).toHaveLength(8);
    expect(FAQ_TOPICS.flatMap((topic) => topic.items)).toHaveLength(48);
    expect((html.match(/class="pg-qa[^"]*is-first/gu) ?? []).length).toBe(8);
    expect(html).toContain('Вопросы о поиске работы: короткие ответы');
  });

  it('keeps the button inside h3, no anchor mark, and says nothing about trials', () => {
    expect(html).toMatch(/<h3><button[^>]*aria-expanded/u);
    expect(html).not.toContain('Коротко');
    expect(html).not.toMatch(/24 час|пробн/iu);
    expect(html).toContain('href="/signup?from=faq"');
  });

  it('puts exactly the visible answers into FAQPage JSON-LD', () => {
    const graph = (faqStructuredData() as { '@graph': Record<string, unknown>[] })['@graph'];
    const faq = graph.find((node) => node['@type'] === 'FAQPage') as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(faq.mainEntity).toHaveLength(48);
    faq.mainEntity.forEach((entity) => {
      expect(html).toContain(entity.name);
      expect(html).toContain(entity.acceptedAnswer.text);
    });
  });
});

describe('/tariffs page', () => {
  const html = renderToStaticMarkup(<TariffsPage onNavigate={noop} />);

  it('lists the five tariffs with Pro recommended and filled', () => {
    ['Free', 'Basic', 'Pro', 'Max', 'Executive'].forEach((name) => expect(html).toContain(name));
    expect(html).toContain('Рекомендуем');
    expect(html).toContain('pg-btn is-primary" href="/signup?plan=pro&amp;from=tariffs"');
    expect(html).toContain('Эксперт проверит резюме вручную до первых откликов');
    expect(html).toContain('/signup?from=tariffs-doubt');
  });

  it('folds the comparison table at the first group boundary', () => {
    expect((html.match(/<tr/gu) ?? []).length).toBe(1 + 5);
    expect(html).toContain('Все возможности тарифов');
  });

  it('promises no trial, card-free sign-up or refund', () => {
    expect(html).not.toMatch(/пробн|без карты|возврат|24 час/iu);
    expect(JSON.stringify(tariffsStructuredData())).toContain('SoftwareApplication');
  });
});
