import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { ADMIN_VACANCY_PAGE_BYTE_BUDGET, buildAdminVacancyPage } from './adminVacancyPage';

/**
 * Прод отдавал список админ-консоли ровно на 20 220 байтах и обрывал его на
 * середине строки при любом `limit` (INC-032). Страница обязана помещаться в
 * тот же доказанный бюджет, что подбор (INC-029) и снимок кандидата (INC-030).
 */
function vacancy(index: number): UnifiedVacancy {
  return {
    id: `vacancy-${index}`,
    fingerprint: `fingerprint-${index}-${'a'.repeat(24)}`,
    title: `Ведущий инженер по данным ${index}`,
    company: `Компания ${index} с довольно длинным названием`,
    location: 'Москва',
    isRemote: index % 2 === 0,
    salary: { from: 250_000, to: 400_000, currency: 'RUR', gross: true },
    description: 'Описание вакансии. '.repeat(80),
    requiredSkills: Array.from({ length: 40 }, (_, s) => `навык-${index}-${s}`),
    employmentType: 'полная занятость',
    experienceLevel: 'senior',
    responsibilities: Array.from({ length: 12 }, (_, r) => `Обязанность номер ${r}`),
    qualifications: Array.from({ length: 12 }, (_, q) => `Требование номер ${q}`),
    niceToHave: Array.from({ length: 8 }, (_, n) => `Будет плюсом ${n}`),
    benefits: Array.from({ length: 8 }, (_, b) => `Бенефит ${b}`),
    aboutCompany: 'О компании. '.repeat(40),
    contactInfo: '@recruiter_contact',
    fullDescription: 'Полный текст поста. '.repeat(120),
    postType: 'vacancy',
    url: `https://example.test/vacancy/${index}`,
    provenance: {
      sourceType: 'telegram',
      sourceId: 'src-telegram-jobs',
      sourceName: 'Telegram @job_react',
      sourceUrl: `https://t.me/job_react/${index}`,
      externalId: `${index}`,
      observedAt: '2026-09-03T10:00:00.000Z',
    },
    publishedAt: '2026-09-03T09:00:00.000Z',
    status: 'active',
  };
}

describe('buildAdminVacancyPage', () => {
  const pool = Array.from({ length: 200 }, (_, index) => vacancy(index));

  it('держит страницу внутри байтового бюджета маршрута', () => {
    const page = buildAdminVacancyPage(pool, 0);
    const size = Buffer.byteLength(JSON.stringify(page.items), 'utf8');
    expect(size).toBeLessThanOrEqual(ADMIN_VACANCY_PAGE_BYTE_BUDGET);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('говорит, сколько всего в выборке и где продолжить', () => {
    const page = buildAdminVacancyPage(pool, 0);
    expect(page.total).toBe(200);
    expect(page.offset).toBe(0);
    expect(page.nextOffset).toBe(page.items.length);

    const next = buildAdminVacancyPage(pool, page.nextOffset ?? 0);
    expect(next.offset).toBe(page.items.length);
    expect(next.items[0]?.id).toBe(pool[page.items.length]?.id);
  });

  it('оставляет в списке то, что печатает карточка, и убирает полный текст', () => {
    const [first] = buildAdminVacancyPage(pool, 0).items;
    expect(first).toBeDefined();
    expect(first.title).toBe(pool[0].title);
    expect(first.company).toBe(pool[0].company);
    expect(first.provenance.sourceName).toBe('Telegram @job_react');
    expect(first.publishedAt).toBe(pool[0].publishedAt);
    expect(first.requiredSkills.length).toBeLessThanOrEqual(6);
    expect(first.skillCount).toBe(40);
    // Полный текст, разделы и «о компании» едут только в карточке записи.
    expect(first).not.toHaveProperty('fullDescription');
    expect(first).not.toHaveProperty('responsibilities');
    expect(first).not.toHaveProperty('qualifications');
    expect(first).not.toHaveProperty('benefits');
    expect(first).not.toHaveProperty('aboutCompany');
    expect(Buffer.byteLength(first.descriptionSnippet, 'utf8')).toBeLessThanOrEqual(400);
  });

  it('запись без локации, зарплаты и уровня едет без выдуманных полей', () => {
    const sparse: UnifiedVacancy = {
      id: 'vacancy-sparse',
      fingerprint: 'fingerprint-sparse',
      title: 'Аналитик',
      company: 'Компания',
      description: 'Короткое описание.',
      requiredSkills: [],
      url: 'https://example.test/sparse',
      provenance: {
        sourceType: 'rss',
        sourceId: 'src-rss',
        sourceUrl: 'https://example.test/feed',
        observedAt: '2026-09-03T10:00:00.000Z',
      },
      publishedAt: '2026-09-03T09:00:00.000Z',
      status: 'active',
    };
    const [item] = buildAdminVacancyPage([sparse], 0).items;
    expect(item).not.toHaveProperty('location');
    expect(item).not.toHaveProperty('salary');
    expect(item).not.toHaveProperty('isRemote');
    expect(item).not.toHaveProperty('employmentType');
    expect(item).not.toHaveProperty('experienceLevel');
    expect(item).not.toHaveProperty('postType');
    expect(item.skillCount).toBe(0);
    expect(item.descriptionSnippet).toBe('Короткое описание.');
  });

  it('отдаёт одну запись, даже когда она одна не влезает в бюджет', () => {
    const huge: UnifiedVacancy = {
      ...vacancy(0),
      title: 'Очень длинная должность. '.repeat(1_000),
    };
    const page = buildAdminVacancyPage([huge], 0);
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBeNull();
  });

  it('запрошенный `limit` сужает страницу, а бюджет остаётся потолком', () => {
    const page = buildAdminVacancyPage(pool, 0, 3);
    expect(page.items).toHaveLength(3);
    expect(page.nextOffset).toBe(3);
  });

  it('кончившийся список не обещает продолжения', () => {
    const page = buildAdminVacancyPage(pool.slice(0, 2), 0);
    expect(page.items).toHaveLength(2);
    expect(page.nextOffset).toBeNull();
  });
});
