import { describe, expect, it } from 'vitest';
import {
  buildVacancySlug,
  vacancyPath,
  catalogPagePath,
  parseVacancyPath,
  vacancyKey,
  listingPath,
  parseListingPath,
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

  /**
   * «Продакт-менеджер» — заимствование, уже стоящее в английском порядке, а
   * «аналитик данных» — русская конструкция «главное слово — уточнение».
   * Разворот слов по правилу ломал первое, поэтому порядок задаёт словарь
   * фраз, а не догадка (найдено на живом пуле 2026-09-07).
   */
  it('не переставляет слова в заимствованной фразе', () => {
    expect(buildVacancySlug('Продакт-менеджер')).toBe('product-manager');
    expect(buildVacancySlug('Менеджер продукта')).toBe('product-manager');
    expect(buildVacancySlug('Product Manager')).toBe('product-manager');
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

  it('оставляет порядок слов таким, каким его задал автор', () => {
    expect(buildVacancySlug('Senior аналитик')).toBe('senior-analyst');
    // Фраза из словаря побеждает пословный перевод: «qa-engineer» — то, как
    // роль называется по-английски, а «engineer-qa» — калька.
    expect(buildVacancySlug('Инженер тестирования')).toBe('qa-engineer');
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

/**
 * Срез 2b: списки по месту и роли — именно те страницы, по которым ищут
 * («frontend developer remote jobs», «вакансии в Москве»). Пример владельца
 * дословно: `/vacancies/remote/frontend-developer` и
 * `/vacancies/moscow/programmist-1c`.
 */
describe('адреса списков каталога (B209, срез 2b)', () => {
  it('строит адрес места и адрес места с ролью', () => {
    expect(listingPath('remote')).toBe('/vacancies/remote');
    expect(listingPath('moscow')).toBe('/vacancies/moscow');
    expect(listingPath('remote', 'frontend-developer')).toBe(
      '/vacancies/remote/frontend-developer',
    );
    expect(listingPath('moscow', 'programmist-1c')).toBe('/vacancies/moscow/programmist-1c');
  });

  it('каждый построенный адрес отвечает правилу адресов', () => {
    for (const path of [
      listingPath('remote', 'frontend-developer'),
      listingPath('moscow', 'programmist-1c'),
      listingPath('saint-petersburg'),
    ]) {
      expect(isValidPublicPath(path!)).toBe(true);
    }
  });

  it('не отдаёт служебный сегмент каталога под место', () => {
    expect(listingPath('job')).toBeNull();
    expect(listingPath('page')).toBeNull();
    expect(listingPath('remote', 'page')).toBeNull();
  });

  it('нумерует страницы списка и разбирает их обратно', () => {
    expect(listingPath('remote', 'frontend-developer', 2)).toBe(
      '/vacancies/remote/frontend-developer/page/2',
    );
    expect(listingPath('moscow', undefined, 3)).toBe('/vacancies/moscow/page/3');
    expect(listingPath('moscow', undefined, 1)).toBe('/vacancies/moscow');
    expect(parseListingPath('/vacancies/remote/frontend-developer/page/2')).toEqual({
      place: 'remote',
      role: 'frontend-developer',
      page: 2,
    });
    expect(parseListingPath('/vacancies/moscow/page/3')).toEqual({ place: 'moscow', page: 3 });
  });

  it('разбирает адрес списка обратно', () => {
    expect(parseListingPath('/vacancies/remote')).toEqual({ place: 'remote' });
    expect(parseListingPath('/vacancies/moscow/programmist-1c')).toEqual({
      place: 'moscow',
      role: 'programmist-1c',
    });
    expect(parseListingPath('/vacancies/remote/frontend-developer/')).toEqual({
      place: 'remote',
      role: 'frontend-developer',
    });
  });

  /** Служебные пути каталога не должны опознаваться как список. */
  it('не путает список со страницей каталога и с карточкой', () => {
    expect(parseListingPath('/vacancies')).toBeNull();
    expect(parseListingPath('/vacancies/page/2')).toBeNull();
    expect(parseListingPath('/vacancies/job/data-analyst-at-acme-x1')).toBeNull();
    expect(parseListingPath('/vacancies/remote/frontend-developer/extra')).toBeNull();
    expect(parseListingPath('/legal/terms')).toBeNull();
  });
});
