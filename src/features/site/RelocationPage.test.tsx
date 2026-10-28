import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RelocationPage, relocationFacts } from './RelocationPage';

describe('relocation public first paint (B354)', () => {
  const html = renderToStaticMarkup(<RelocationPage onNavigate={() => {}} />);

  it('shows the example as three different countries with sources', () => {
    expect((html.match(/<h1[ >]/gu) ?? []).length).toBe(1);
    expect(html).toContain('Пример результата');
    expect((html.match(/<article/gu) ?? []).length).toBe(3);
    for (const country of ['Германия', 'ОАЭ', 'Грузия'])
      expect(html).toContain(`<h3>${country}</h3>`);
    expect(html).toContain('make-it-in-germany.com');
    expect(html).toContain('Предварительная оценка');
    expect(html).toContain('Сохранить оценку — бесплатно');
    expect(html).toContain('Скопировать ссылку');
    expect(html).toContain('Полная оценка в Pro');
    expect(html).toContain('Что дальше');
    expect(html).toContain('Три пути, которые вам открыты');
    for (const href of ['/salaries/germany', '/tools/resume', '/tools/interview-questions'])
      expect(html).toContain(`href="${href}"`);
    expect(html).toContain('href="/tools/relocation">В какую страну переехать');
    expect(html).toContain(
      'href="/vacancies/relocation">Вакансии с релокацией в открытом каталоге',
    );
    expect(html).toContain('Налога на доход нет');
    expect(html).not.toContain('пока недоступно');
  });

  it('takes every threshold from shared/countryFit', () => {
    const facts = relocationFacts();
    expect(facts.blueCard.amount).toBe(50_700);
    expect(facts.opportunity.amount).toBe(1_091);
    expect(facts.uaeRemote.currency).toBe('USD');
    expect(html).toContain('50 700 €');
    expect(html).toContain(`проверены ${facts.checkedAt.split('-').reverse().join('.')}`);
  });

  it('asks the first question with the step counter', () => {
    expect(html).toContain('Вопрос 1 из 6');
    expect(html).toContain('Какое у вас гражданство?');
    expect((html.match(/itemProp="mainEntity"/gu) ?? []).length).toBe(6);
  });
});
