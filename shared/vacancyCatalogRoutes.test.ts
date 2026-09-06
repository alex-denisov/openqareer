import { describe, expect, it } from 'vitest';
import {
  buildVacancySlug,
  vacancyPath,
  catalogPagePath,
  parseVacancyPath,
  vacancyKey,
  CATALOG_ROOT,
} from './vacancyCatalogRoutes';
import { isValidPublicPath } from './seoSlugPolicy';

describe('адреса публичного каталога вакансий (B209)', () => {
  it('строит слаг из естественного английского названия', () => {
    expect(buildVacancySlug('Lead DevOps Engineer')).toBe('lead-devops-engineer');
    expect(buildVacancySlug('Senior Backend Engineer (TS/Node)')).toBe(
      'senior-backend-engineer-ts-node',
    );
    expect(buildVacancySlug('  Director,  Privacy Legal ')).toBe('director-privacy-legal');
  });

  it('переводит русское название роли на английский, а не транслитерирует', () => {
    expect(buildVacancySlug('Разработчик интерфейсов')).toBe('frontend-developer');
    expect(buildVacancySlug('Аналитик данных')).toBe('data-analyst');
    expect(buildVacancySlug('Бухгалтер')).toBe('accountant');
  });

  it('пропускает 1С как исконно российский продукт', () => {
    expect(buildVacancySlug('Программист 1С')).toBe('programmist-1c');
    expect(isValidPublicPath(`/vacancies/moscow/${buildVacancySlug('Программист 1С')}`)).toBe(true);
  });

  it('не выдаёт транслит, когда перевода нет — слаг остаётся честно пустым', () => {
    expect(buildVacancySlug('Специалист по щебню')).toBeNull();
  });

  /**
   * Идентификатор кластера содержит дефисы и двоеточия, поэтому в адрес он
   * идёт коротким устойчивым ключом: иначе разобрать адрес обратно нельзя —
   * непонятно, где кончается название и начинается идентификатор.
   */
  it('строит адрес карточки, который проходит политику адресов', () => {
    const path = vacancyPath({
      id: 'board-12:cluster-42',
      title: 'Director, Privacy Legal',
      company: 'Reddit',
    });
    expect(path).toMatch(/^\/vacancies\/job\/director-privacy-legal-at-reddit-[a-z0-9]+$/u);
    expect(isValidPublicPath(path!)).toBe(true);
  });

  it('даёт один и тот же адрес одной и той же вакансии', () => {
    const first = vacancyPath({ id: 'board-12:cluster-42', title: 'Data Analyst', company: 'Acme' });
    const second = vacancyPath({ id: 'board-12:cluster-42', title: 'Data Analyst', company: 'Acme' });
    const other = vacancyPath({ id: 'board-12:cluster-43', title: 'Data Analyst', company: 'Acme' });
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  it('опускает работодателя, когда его имя не ложится в английский адрес', () => {
    const path = vacancyPath({ id: 'c9', title: 'Data Analyst', company: 'Рога и копыта' });
    expect(path).toMatch(/^\/vacancies\/job\/data-analyst-[a-z0-9]+$/u);
    expect(isValidPublicPath(path!)).toBe(true);
  });

  it('не строит адрес, когда роль не переводится на английский', () => {
    expect(vacancyPath({ id: 'c1', title: 'Специалист по щебню', company: 'Рога и копыта' })).toBeNull();
  });

  it('разбирает адрес карточки обратно в короткий ключ', () => {
    const path = vacancyPath({ id: 'board-12:cluster-42', title: 'Data Analyst', company: 'Acme' })!;
    expect(parseVacancyPath(path)).toBe(vacancyKey('board-12:cluster-42'));
    expect(parseVacancyPath('/vacancies')).toBeNull();
    expect(parseVacancyPath('/vacancies/job/')).toBeNull();
    expect(parseVacancyPath('/vacancies/job')).toBeNull();
  });

  it('строит адреса страниц каталога', () => {
    expect(catalogPagePath(1)).toBe(CATALOG_ROOT);
    expect(catalogPagePath(3)).toBe('/vacancies/page/3');
    expect(isValidPublicPath(catalogPagePath(3))).toBe(true);
  });

  it('называет роль вокруг 1С по-русски транслитом — это исключение владельца', () => {
    expect(buildVacancySlug('Аналитик 1С')).toBe('analitik-1c');
    // Одна лишь цифра роли не называет: адрес `/vacancies/job/1c-…` читателю
    // ничего не говорит, поэтому вакансия остаётся без публичного адреса.
    expect(buildVacancySlug('1С')).toBeNull();
    expect(buildVacancySlug('ИТ-лидер команды (1с, финансовый блок)')).toBeNull();
    expect(buildVacancySlug('Консультант 1C')).toBe('konsultant-1c');
  });

  it('не строит слаг из пустого или служебного названия', () => {
    expect(buildVacancySlug('')).toBeNull();
    expect(buildVacancySlug('   ')).toBeNull();
    expect(buildVacancySlug('по и на')).toBeNull();
  });

  it('оставляет порядок слов смешанной фразы таким, каким его задал автор', () => {
    expect(buildVacancySlug('Senior аналитик')).toBe('senior-analyst');
  });

  it('не принимает за карточку чужой путь', () => {
    expect(parseVacancyPath('/legal/privacy')).toBeNull();
    expect(parseVacancyPath('/vacancies/job/a/b')).toBeNull();
    expect(parseVacancyPath('/vacancies/page/2')).toBeNull();
  });

  it('разбирает адрес с завершающим слэшем и с запросом', () => {
    const path = vacancyPath({ id: 'x1', title: 'Data Analyst', company: 'Acme' })!;
    expect(parseVacancyPath(`${path}/`)).toBe(vacancyKey('x1'));
    expect(parseVacancyPath(`${path}?utm=1`)).toBe(vacancyKey('x1'));
  });

  it('сводит нулевую и отрицательную страницу к корню каталога', () => {
    expect(catalogPagePath(0)).toBe(CATALOG_ROOT);
    expect(catalogPagePath(-3)).toBe(CATALOG_ROOT);
  });
});
