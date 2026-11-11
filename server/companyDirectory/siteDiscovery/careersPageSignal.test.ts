import { describe, expect, it } from 'vitest';
import { careersPageVerdict } from './careersPageSignal';

const pad = 'x'.repeat(600);

describe('B643 careers page signal', () => {
  it('accepts a page whose title or heading names vacancies', () => {
    expect(careersPageVerdict(`<title>Вакансии — Сулпак</title>${pad}`)).toBe('ok');
    expect(careersPageVerdict(`<h1 class="a">Join our team</h1>${pad}`)).toBe('ok');
    expect(careersPageVerdict(`<h2>Open positions</h2>${pad}`)).toBe('ok');
    expect(careersPageVerdict(`<title>Карьера в компании</title>`)).toBe('ok');
  });

  it('accepts a page with an embedded ATS board', () => {
    expect(careersPageVerdict(`<title>Acme</title><a href="https://jobs.lever.co/acme">x</a>`)).toBe('ok');
  });

  it('rejects a product page with no vacancy words in headings', () => {
    const html = `<title>Контейнеры для генераторов — Склад генераторов</title><h1>Контейнер ПБК-6</h1>${pad}<a href="/vacansii">Вакансии</a>`;
    expect(careersPageVerdict(html)).toBe('no_vacancy_signal');
  });

  it('rejects a 404 page served with HTTP 200', () => {
    expect(careersPageVerdict(`<title>Страница не найдена</title><h1>Вакансии</h1>`)).toBe('not_found_page');
    expect(careersPageVerdict(`<title>Careers</title><h1>404 — Page not found</h1>`)).toBe('not_found_page');
  });

  it('rejects a news article whose heading only mentions hiring in passing', () => {
    expect(careersPageVerdict(`<title>Компания разработает новую модель</title><h1>Новости</h1>${pad}`)).toBe('no_vacancy_signal');
  });
});
