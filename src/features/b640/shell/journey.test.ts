import { describe, expect, it } from 'vitest';
import { journeyTo, keepKeyOf, navOfTrail, parseJourney, returnsTo } from './journey';
import { rememberVacancy } from './vacancyNames';

const LIST = '/app/vacancies?ready=1';
const LETTER = '/app/responses/v1/letter';

describe('путь отклика по источнику (B798)', () => {
  it('из «Вакансий»: первое звено и раздел — «Вакансии», фильтры в адресе целы', () => {
    const journey = journeyTo(LETTER, LIST, {});
    expect(journey.trail).toEqual([{ label: 'Вакансии', path: LIST }]);
    expect(navOfTrail(journey.trail)).toBe('vacancies');
  });

  it('список → карточка → отклик: путь копится, возврат на карточку его укорачивает', () => {
    const card = journeyTo('/app/vacancies/v1', LIST, {});
    const letter = journeyTo(LETTER, '/app/vacancies/v1', card);
    expect(letter.trail?.map((stop) => stop.path)).toEqual([LIST, '/app/vacancies/v1']);
    expect(navOfTrail(letter.trail)).toBe('vacancies');
    expect(returnsTo(LIST, LETTER, letter)).toBe(true);
    expect(journeyTo('/app/vacancies/v1', LETTER, letter).trail).toEqual(card.trail);
  });

  it('из «Сегодня» и «Откликов» раздел — их', () => {
    expect(navOfTrail(journeyTo(LETTER, '/app/today', {}).trail)).toBe('today');
    const fromRow = journeyTo(LETTER, '/app/responses/r1', {}).trail;
    expect(fromRow?.map((stop) => stop.label)).toEqual(['Отклики', 'Отклик']);
    expect(navOfTrail(fromRow)).toBe('responses');
  });

  it('раздел открывается заново, родной родитель — возврат', () => {
    expect(journeyTo('/app/vacancies', LETTER, {})).toEqual({});
    expect(returnsTo('/app/vacancies', '/app/vacancies/v1', {})).toBe(true);
    expect(returnsTo('/app/vacancies', '/app/today', {})).toBe(false);
  });

  it('название, известное со списка, идёт вместе с переходом', () => {
    rememberVacancy('v1', { vacancyId: 'v1', title: 'CTO', company: 'Гринкод' });
    expect(journeyTo(LETTER, LIST, {}).vacancy?.title).toBe('CTO');
  });

  it('чужая запись истории отбрасывается', () => {
    expect(parseJourney(null)).toEqual({});
    expect(parseJourney({ b640: { trail: [{ label: 'x', path: 'https://evil.example' }] } })).toEqual({});
    const journey = journeyTo(LETTER, LIST, {});
    expect(parseJourney(JSON.parse(JSON.stringify({ b640: journey })))).toEqual(journey);
  });

  it('список и раскрытая строка откликов — один экран', () => {
    expect(keepKeyOf('/app/responses/r1')).toBe(keepKeyOf('/app/responses'));
    expect(keepKeyOf(LETTER)).toBeNull();
  });
});
