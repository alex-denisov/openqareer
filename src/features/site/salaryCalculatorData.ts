/** Mockup 05 copy (landing-2026-10-26/05-salary-calculator.html); figures in answers are checked against the calculator in the tests. */
export const CALC_TITLE = 'Калькулятор НДФЛ и зарплаты на руки 2026 · openqareer';
export const CALC_DESCRIPTION =
  'Посчитайте зарплату на руки после НДФЛ по прогрессивной шкале 2026 года: по месяцам, с переходом на 15 % после 2,4 млн ₽. Плюс Германия, Кипр, Сербия, ОАЭ и Грузия.';

export const CALC_SCALE: readonly { readonly rate: string; readonly range: string }[] = [
  { rate: '13 %', range: 'до 2,4 млн ₽' },
  { rate: '15 %', range: '2,4–5 млн ₽' },
  { rate: '18 %', range: '5–20 млн ₽' },
  { rate: '20 %', range: '20–50 млн ₽' },
  { rate: '22 %', range: 'свыше 50 млн ₽' },
];

export const CALC_NEXT: readonly {
  readonly href: string;
  readonly title: string;
  readonly text: string;
}[] = [
  {
    href: '/salaries/accountant',
    title: 'Зарплаты по профессиям',
    text: 'Вилки из вакансий по городам, с выборкой и датой.',
  },
  {
    href: '/salaries/germany',
    title: 'Германия: сколько остаётся на руки',
    text: 'Таблица от 2 000 до 10 000 € в месяц и порог Blue Card.',
  },
  {
    href: '/tools/relocation',
    title: 'На руки в другой стране',
    text: 'Пути переезда, которые подходят вам, и зарплата после налогов.',
  },
  {
    href: '/signup?from=calc',
    title: 'Вакансии от нужной суммы',
    text: 'Задайте зарплату на руки — openqareer покажет вакансии, где столько платят.',
  },
];

export const CALC_FAQ: readonly { readonly q: string; readonly a: string }[] = [
  {
    q: 'Сколько будет на руки со 150 000 ₽?',
    a: '130 500 ₽ в месяц: НДФЛ 13 % — 19 500 ₽. За год выходит 1,8 млн ₽, это меньше 2,4 млн ₽, поэтому ставка не повышается.',
  },
  {
    q: 'Когда НДФЛ становится 15 %?',
    a: 'С той части дохода за год, которая превышает 2,4 млн ₽, и только начиная с месяца, когда сумма с начала года перешла порог. При 300 000 ₽ в месяц это сентябрь: за 8 месяцев набирается ровно 2,4 млн ₽.',
  },
  {
    q: 'Учитываются ли вычеты?',
    a: 'Нет: калькулятор считает без стандартных и имущественных вычетов. С вычетами на руки будет больше.',
  },
  {
    q: 'Почему в Германии на руки меньше, чем «минус налог»?',
    a: 'Из зарплаты удерживаются ещё пенсионный взнос, медстраховка, страхование по безработице и уходу. Калькулятор считает их по ставкам 2026 года для I налогового класса.',
  },
];

const SITE = 'https://openqareer.com';

export const CALC_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Зарплаты', item: `${SITE}/salaries` },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Калькулятор зарплаты на руки',
          item: `${SITE}/tools/salary-calculator`,
        },
      ],
    },
    {
      '@type': 'WebApplication',
      name: 'Калькулятор зарплаты на руки',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      inLanguage: 'ru-RU',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: CALC_FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ],
};
