/**
 * B569: copy of the public /tariffs page, from the approved mockup
 * (landing-2026-10-26/09-tariffs.html). Names and prices come from the
 * cabinet's tariff table, so the two cannot drift apart.
 */
import { TARIFF_LEVELS, type TariffTierId } from '../tariffs/tariffsData';

export const TARIFFS_TITLE = 'Тарифы openqareer: бесплатно, от 3 990 ₽ в месяц, поиск под ключ';
export const TARIFFS_DESCRIPTION =
  'Начните бесплатно. Basic 3 990 ₽ — резюме под каждую вакансию, Pro 9 900 ₽ — отклики за вас по вашим правилам, Max 39 900 ₽ — самая сильная модель консультанта.';

export interface PlanCard {
  readonly id: TariffTierId;
  readonly name: string;
  readonly who: string;
  readonly price: string;
  readonly term: string;
  /** First line "Всё из …, плюс:" has no tick. */
  readonly lead?: string;
  readonly points: readonly string[];
  readonly hint?: { readonly text: string; readonly href: string };
  readonly cta: { readonly label: string; readonly href: string };
  readonly recommended?: boolean;
}

function levelField(id: TariffTierId, field: 'name' | 'price'): string {
  const level = TARIFF_LEVELS.find((candidate) => candidate.id === id);
  if (!level) throw new Error(`tariff ${id} is not defined`);
  return level[field];
}

const name = (id: TariffTierId) => levelField(id, 'name');
const price = (id: TariffTierId) => levelField(id, 'price');

export const PLAN_CARDS: readonly PlanCard[] = [
  {
    id: 'free',
    name: name('free'),
    who: 'Увидеть свой рынок',
    price: price('free'),
    term: 'навсегда',
    points: [
      'Сильное резюме из вашего опыта и проверка на ATS',
      'Должности, куда вы проходите, и зарплаты по ним',
      'Вакансии со всего рынка, процент совпадения для первых 300',
      'Консультант: 30 ходов в месяц',
      '20 писем к вакансиям в месяц',
      'Все отклики в одном списке',
      'Карьерный дневник',
    ],
    hint: { text: 'Basic — когда на отклики нет ответа', href: '/faq#why-no-job-offers' },
    cta: { label: 'Найти работу', href: '/signup?from=tariffs' },
  },
  {
    id: 'go',
    name: name('go'),
    who: 'Резюме и письмо под каждую вакансию',
    price: price('go'),
    term: 'в месяц',
    lead: 'Всё из Free, плюс:',
    points: [
      '100 откликов с резюме и письмом в месяц',
      'Консультант: 300 ходов в месяц',
      'Выход на людей внутри компании',
      'Тренажёр собеседования с ИИ: 10 тренировок в месяц',
      'Аудит профиля LinkedIn',
    ],
    cta: { label: 'Выбрать Basic', href: '/signup?plan=basic&from=tariffs' },
  },
  {
    id: 'pro',
    name: name('pro'),
    who: 'Пока openqareer откликается, вы готовитесь к встречам',
    price: price('pro'),
    term: 'в месяц',
    lead: 'Всё из Basic, плюс:',
    points: [
      'Отклики за вас каждый день по вашим правилам: 500 в месяц',
      'Консультант: 1 000 ходов, 30 тренировок собеседования в месяц',
      '90 черновиков LinkedIn в месяц',
      'Подготовка к торгу: какую сумму назвать и как её обосновать',
      'Полная оценка переезда',
      'Каждый отправленный отклик виден в списке',
    ],
    cta: { label: 'Выбрать Pro', href: '/signup?plan=pro&from=tariffs' },
    recommended: true,
  },
  {
    id: 'max',
    name: name('max'),
    who: 'Самая сильная модель консультанта',
    price: price('max'),
    term: 'в месяц',
    lead: 'Всё из Pro, плюс:',
    points: [
      'Консультант на самой сильной модели: 3 000 ходов в месяц',
      '2 000 откликов с резюме и письмом в месяц',
      '100 тренировок собеседования, 210 черновиков LinkedIn',
      'Анонимный режим',
    ],
    cta: { label: 'Выбрать Max', href: '/signup?plan=max&from=tariffs' },
  },
  {
    id: 'exec',
    name: name('exec'),
    who: 'Для руководителей: позиции, которых нет в вакансиях',
    price: 'от 150 тыс. ₽',
    term: 'разово, по заявке: 150–300 тыс. ₽',
    points: [
      'Поиск командой под ключ',
      'Закрытый рынок и рекрутеры',
      'Знакомство с работодателем через связи',
    ],
    cta: { label: 'Оставить заявку', href: '#executive-form' },
  },
];

export interface ReplyMode {
  readonly badge: string;
  readonly title: string;
  readonly text: string;
  readonly accent?: boolean;
}

export const REPLY_MODES: readonly ReplyMode[] = [
  {
    badge: 'Basic и выше',
    title: 'Только черновики',
    text: 'openqareer готовит резюме и письмо под вакансию, вы отправляете сами.',
  },
  {
    badge: 'Pro',
    title: 'Одобрение каждого',
    text: 'Отклики собираются в очередь. Вы читаете и одобряете — openqareer отправляет.',
  },
  {
    badge: 'Pro',
    title: 'Автоматически по правилам',
    text: 'Вы один раз задаёте правила: какие вакансии, от какой зарплаты, сколько откликов в день. openqareer откликается сам и показывает каждый отправленный отклик. Режим включается отдельным согласием в кабинете и выключается в один клик.',
    accent: true,
  },
];

export type CompareRow =
  { readonly group: string } | { readonly label: string; readonly marks: string };

/** `marks`: one letter per tariff (Free, Basic, Pro, Max, Executive): y = included. */
export const COMPARE_ROWS: readonly CompareRow[] = [
  { group: 'Резюме и вакансии' },
  { label: 'Резюме из вашего опыта, проверка на ATS', marks: 'yyyyy' },
  { label: 'Должности, на которые вы проходите', marks: 'yyyyy' },
  { label: 'Вакансии из 324 источников с процентом совпадения', marks: 'yyyyy' },
  { label: 'Резюме и письмо под каждую вакансию', marks: 'nyyyy' },
  { group: 'Отклики' },
  { label: 'Все отклики и ответы в одном месте', marks: 'yyyyy' },
  { label: 'Отклики за вас по вашим правилам', marks: 'nnyyy' },
  { label: 'Выход на людей в компании', marks: 'nyyyy' },
  { group: 'Собеседование и оффер' },
  { label: 'Тренажёр собеседования с ИИ, истории STAR', marks: 'nyyyy' },
  { label: 'Подготовка к торгу по офферу', marks: 'nnyyy' },
  { label: 'Самая сильная модель консультанта', marks: 'nnnyy' },
  { group: 'Переезд и другое' },
  { label: 'Калькулятор зарплаты на руки', marks: 'yyyyy' },
  { label: 'Полная оценка переезда', marks: 'nnyyy' },
  { label: 'Карьерный дневник: цели, итоги недель, достижения', marks: 'yyyyy' },
  { label: 'Поиск командой и закрытый рынок', marks: 'nnnny' },
];

export interface PaymentQuestion {
  readonly q: string;
  readonly a: string;
  readonly open?: boolean;
  readonly more?: { readonly text: string; readonly href: string };
}

export const PAYMENT_FAQ: readonly (readonly PaymentQuestion[])[] = [
  [
    {
      q: 'Как отменить подписку?',
      a: 'В кабинете, в один клик. Тариф работает до конца оплаченного месяца.',
      open: true,
    },
  ],
  [
    {
      q: 'Что можно бесплатно?',
      a: 'Резюме и проверка на ATS, подходящие должности, вакансии со всего рынка и все отклики в одном месте — без срока.',
      more: { text: 'Подробнее', href: '/faq#service' },
    },
    {
      q: 'Как оплатить?',
      a: 'Картой, через СБП, SberPay или T-Pay. Оплата помесячная, договор не нужен.',
    },
    {
      q: 'Отправит ли openqareer отклик туда, куда я не хочу?',
      a: 'Отклики уходят только на вакансии, которые подходят под ваши правила: должность, зарплата, город или удалёнка, лимит в день. Автоматическая отправка включается отдельным согласием и только на Pro; без него openqareer готовит черновики или ждёт вашего одобрения. Каждый отправленный отклик виден в списке.',
    },
  ],
];
