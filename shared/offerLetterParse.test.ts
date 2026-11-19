import { describe, expect, it } from 'vitest';
import { parseOfferLetter } from './offerLetterParse';

const NOW = new Date('2026-11-10T09:00:00Z');

describe('parseOfferLetter: ten real letter formats', () => {
  it('1. the O6a mockup letter: take-home salary, probation, bonus in salaries, hybrid, benefits, dates', () => {
    const text =
      'Здравствуйте, Марина! Рады предложить вам должность руководителя разработки. Оклад 520 000 ₽ в месяц на руки. Первые 3 месяца — испытательный срок, оклад на нём 500 000 ₽. Годовая премия до 2 окладов. Формат: гибрид, 2 дня в офисе. ДМС со стоматологией и оплата спорта. Выход 1 декабря. Просим ответить до 14 ноября.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 520_000,
      salaryPeriod: 'month',
      currency: 'RUB',
      net: true,
      probationPeriodMonths: 3,
      probationSalary: 500_000,
      bonus: 1_040_000,
      format: 'hybrid',
      benefits: ['ДМС со стоматологией', 'оплата спорта'],
      startDate: '2026-12-01',
      respondBy: '2026-11-14',
    });
  });

  it('2. English, dollars per month, gross, remote, numeric deadline', () => {
    const text =
      'Hi Marina, we are happy to offer you the Head of Engineering role. Base salary: $6,500 per month (gross). This is a fully remote position. Please let us know by 18.11.2026. Start date: December 15, 2026.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 6_500,
      salaryPeriod: 'month',
      currency: 'USD',
      net: false,
      format: 'remote',
      respondBy: '2026-11-18',
      startDate: '2026-12-15',
    });
  });

  it('3. English, yearly euros in thousands, bonus as a percent, office, probation', () => {
    const text =
      'We are pleased to offer you a base salary of €90k per year plus an annual bonus of 15% of base salary. The role is on-site in our Berlin office. There is a 6-month probation period. Kindly respond by November 20.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 90_000,
      salaryPeriod: 'year',
      currency: 'EUR',
      bonus: 13_500,
      format: 'office',
      probationPeriodMonths: 6,
      respondBy: '2026-11-20',
    });
  });

  it('4. Russian, salary in thousands of rubles before tax, bonus as an amount', () => {
    const text =
      'Предлагаем оклад 350 тыс. руб. до вычета НДФЛ. Годовой бонус 600 000 рублей по итогам года. Работа в офисе на Павелецкой.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 350_000,
      salaryPeriod: 'month',
      currency: 'RUB',
      net: false,
      bonus: 600_000,
      format: 'office',
    });
  });

  it('5. a salary range is not turned into one number', () => {
    const text = 'Вилка по позиции — от 400 000 до 480 000 ₽ в месяц, окончательная сумма после финального интервью. Удалёнка.';
    expect(parseOfferLetter(text, NOW)).toEqual({ format: 'remote' });
  });

  it('6. Russian, bonus as a percent of the yearly income', () => {
    const text =
      'Заработная плата — 300 000 рублей в месяц. Премия 20% от годового оклада. Гибридный график. Ответ ждём до 25.11.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 300_000,
      salaryPeriod: 'month',
      currency: 'RUB',
      bonus: 720_000,
      format: 'hybrid',
      respondBy: '2026-11-25',
    });
  });

  it('7. English annual salary with a comma; a one-time sign-on bonus is not a yearly bonus', () => {
    const text =
      'Your annual base salary will be USD 145,000. You will also receive a one-time sign-on bonus of USD 10,000. Benefits: health insurance, 401(k) match, gym membership.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 145_000,
      salaryPeriod: 'year',
      currency: 'USD',
      benefits: ['health insurance', '401(k) match', 'gym membership'],
    });
  });

  it('8. a letter without terms fills nothing', () => {
    const text = 'Марина, спасибо за встречу! Команда в восторге, на днях пришлём оффер.';
    expect(parseOfferLetter(text, NOW)).toEqual({});
  });

  it('9. probation salary in English and a deadline next year', () => {
    const text =
      'The monthly salary is 4 000 EUR net. During the 3-month probation period the salary is 3 600 EUR. Please confirm by January 10.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 4_000,
      salaryPeriod: 'month',
      currency: 'EUR',
      net: true,
      probationPeriodMonths: 3,
      probationSalary: 3_600,
      respondBy: '2027-01-10',
    });
  });

  it('10. Russian salary in millions per year without a currency word stays in rubles', () => {
    const text = 'Годовой доход — 7,2 млн до налогов. Испытательный срок — два месяца. Компенсация обучения и ДМС.';
    expect(parseOfferLetter(text, NOW)).toEqual({
      baseSalary: 7_200_000,
      salaryPeriod: 'year',
      currency: 'RUB',
      net: false,
      probationPeriodMonths: 2,
      benefits: ['Компенсация обучения', 'ДМС'],
    });
  });
});
