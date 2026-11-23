import { describe, expect, it } from 'vitest';
import { extractVacancyPage } from './extractVacancyPage';
import { timeBudget } from '../../../shared/testing/timeBudget';

const LONG = 'Вы будете строить платформу данных. '.repeat(20);
const DESC = `<p>${LONG}</p><h3>Требования</h3><ul><li>Python 5 лет</li><li>SQL</li></ul>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const page = (head: string, body = '') => `<html><head><title>Страница</title>${head}</head><body>${body}</body></html>`;
const posting = {
  '@type': 'JobPosting', title: 'Инженер данных', description: DESC,
  hiringOrganization: { '@type': 'Organization', name: 'Ромашка' },
  jobLocation: { address: { addressLocality: 'Москва', addressCountry: 'RU' } },
};

describe('extractVacancyPage', () => {
  it('JSON-LD JobPosting: поля и текст без разметки', () => {
    const out = extractVacancyPage(page(ld(posting)));
    expect(out).toMatchObject({ title: 'Инженер данных', company: 'Ромашка', location: 'Москва, RU' });
    expect(out.text).not.toMatch(/<|>/u);
    expect(out.text).toContain('Требования');
    expect(out.text).toContain('- Python 5 лет');
    expect(out.text.split('\n\n').length).toBeGreaterThan(2);
  });
  it('B676: baseSalary JSON-LD — деньги вакансии; «\\n» из описания — перевод строки', () => {
    const paid = {
      ...posting,
      description: `${DESC}\\n<p>Benefits</p>`,
      baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { minValue: 114000, maxValue: 130000, unitText: 'YEAR' } },
    };
    const out = extractVacancyPage(page(ld(paid)));
    expect(out.salary).toEqual({ from: 114_000, to: 130_000, currency: 'USD', period: 'year' });
    expect(out.text).not.toContain('\\n');
    expect(extractVacancyPage(page(ld(posting))).salary).toBeNull();
  });
  it('@graph и массив', () => {
    expect(extractVacancyPage(page(ld({ '@graph': [{ '@type': 'WebSite' }, posting] }))).title).toBe('Инженер данных');
    expect(extractVacancyPage(page(ld([{ '@type': 'Organization' }, posting]))).title).toBe('Инженер данных');
  });
  it('описание, экранированное дважды (&lt;p&gt;), тоже становится текстом', () => {
    const escaped = { ...posting, description: '&lt;p&gt;' + LONG + '&lt;/p&gt;&lt;li&gt;SQL&lt;/li&gt;' };
    const out = extractVacancyPage(page(ld(escaped)));
    expect(out.text).not.toMatch(/&lt;|<|>/u);
    expect(out.text).toContain('SQL');
  });
  it('удалённая работа из jobLocationType', () => {
    expect(extractVacancyPage(page(ld({ ...posting, jobLocationType: 'TELECOMMUTE' }))).workFormat).toBe('remote');
    expect(extractVacancyPage(page(ld(posting))).workFormat).toBeNull();
  });
  it('microdata schema.org/JobPosting', () => {
    const body = `<div itemscope itemtype="https://schema.org/JobPosting">
      <h1 itemprop="title">Аналитик</h1>
      <span itemprop="hiringOrganization" itemscope><span itemprop="name">Лютик</span></span>
      <div itemprop="description">${DESC}</div></div>`;
    expect(extractVacancyPage(page('', body))).toMatchObject({ title: 'Аналитик', company: 'Лютик' });
  });
  it('только текст: OpenGraph и основной текст', () => {
    const out = extractVacancyPage(page('<meta property="og:title" content="Менеджер продукта">',
      `<nav>Меню меню</nav><main><p>${LONG}</p></main><footer>Подвал</footer>`));
    expect(out.title).toBe('Менеджер продукта');
    expect(out.text).toContain('платформу данных');
    expect(out.text).not.toContain('Меню');
    expect(out.company).toBeNull();
  });
  it('скрипт страницы не выполняется', () => {
    const body = `<p id="x">${LONG}</p><script>document.getElementById('x').textContent='ПОДМЕНА'; document.body.innerHTML='';</script>`;
    const out = extractVacancyPage(page('', body));
    expect(out.text).toContain('платформу данных');
    expect(out.text).not.toContain('ПОДМЕНА');
  });
  it('короткая страница — thin', () => {
    expect(extractVacancyPage(page('', '<p>Короткий текст</p>')).thin).toBe(true);
    expect(extractVacancyPage(page(ld(posting))).thin).toBe(false);
  });
  it('страница проверки «не робот» не считается вакансией', () => {
    const out = extractVacancyPage(page('', '<h1>Captcha</h1><p>Подтвердите, что вы не робот</p>'));
    expect(out.botWall).toBe(true);
  });
});

describe('extractVacancyPage: страница-ловушка не держит поток', () => {
  const MB = 1_500_000;
  it.each([
    ['незакрытые служебные теги', '<nav>'.repeat(MB / 5)],
    ['незакрытые скобки', '<a '.repeat(MB / 3)],
    ['незакрытые скрипты JSON-LD', '<script type="application/ld+json">{'.repeat(MB / 40)],
    ['много itemprop без закрытия', '<div itemscope itemtype="https://schema.org/JobPosting">' + '<span itemprop="x">'.repeat(MB / 20)],
    ['одна скобка и много itemprop', 'itemtype="https://schema.org/JobPosting" <' + 'itemprop=x >'.repeat(MB / 12)],
    ['много meta и одна далёкая скобка', '<meta '.repeat(MB / 6) + '>'],
    ['незакрытые main', '<main>'.repeat(MB / 6)],
    ['itemprop без открывающей скобки', 'itemtype="https://schema.org/JobPosting" ' + 'itemprop=x '.repeat(MB / 11) + '>'],
  ])('%s — меньше секунды', (_name, html) => {
    const started = performance.now();
    extractVacancyPage(html);
    expect(performance.now() - started).toBeLessThan(timeBudget(1_000));
  });
});
