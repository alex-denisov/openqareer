/**
 * B569: copy of the home page, taken from the approved mockup 01-home.html.
 * Tariff names and prices come from tariffsData.ts; only the card texts live
 * here, because the mockup words them for the landing.
 */
import { TARIFF_LEVELS, type TariffTierId } from '../tariffs/tariffsData';

export const HERO_SOURCES = ['hh.ru', 'LinkedIn', 'Telegram-каналы', 'Сайты компаний'] as const;

export const HOW_STEPS = [
  ['Сильное резюме из вашего опыта', 'Из старого резюме или профиля hh.ru и LinkedIn.'],
  ['Должности и зарплаты', 'Куда вы проходите уже сейчас и сколько там платят.'],
  ['Вакансии со всего рынка', 'Новые каждый день, с процентом совпадения.'],
  ['Резюме и письмо под вакансию', 'Одной кнопкой и только из ваших реальных фактов.'],
  ['Отклики за вас', 'По вашим правилам: какие вакансии, от какой зарплаты, сколько в день.'],
  ['Собеседование и оффер', 'Тренажёр с ИИ, ответы из вашего опыта и подготовка к торгу.'],
] as const;

export type ToolIcon = 'list' | 'calc' | 'target' | 'doc' | 'chat' | 'globe';

export interface HomeTool {
  readonly href: string;
  readonly icon: ToolIcon;
  readonly title: string;
  readonly text: string;
}

export const HOME_TOOLS: readonly HomeTool[] = [
  {
    href: '/vacancies',
    icon: 'list',
    title: 'Каталог вакансий',
    text: 'По городам и профессиям, удалённые тоже.',
  },
  {
    href: '/tools/salary-calculator',
    icon: 'calc',
    title: 'Калькулятор зарплаты на руки',
    text: 'НДФЛ 2026 и налоги ещё в пяти странах.',
  },
  {
    href: '/salaries',
    icon: 'target',
    title: 'Зарплаты по профессиям',
    text: 'Сколько просить на вашей должности и в вашем городе.',
  },
  {
    href: '/tools/resume',
    icon: 'doc',
    title: 'Конструктор резюме',
    text: 'По шагам, с примерами. Скачать в PDF и DOCX.',
  },
  {
    href: '/tools/interview-questions',
    icon: 'chat',
    title: 'Вопросы на собеседовании',
    text: 'По профессиям, с разбором сильного ответа.',
  },
  {
    href: '/tools/relocation',
    icon: 'globe',
    title: 'В какую страну переехать',
    text: 'Какие пути открыты с вашим паспортом и профессией.',
  },
];

export interface HomeTier {
  readonly id: TariffTierId;
  readonly name: string;
  readonly who: string;
  readonly price: string;
  readonly term: string;
  readonly lead?: string;
  readonly items: readonly string[];
  readonly action: { readonly label: string; readonly href: string };
  readonly memberAction?: { readonly label: string; readonly href: string };
  readonly recommended: boolean;
}

interface TierText {
  readonly who: string;
  readonly term: string;
  readonly price?: string;
  readonly lead?: string;
  readonly items: readonly string[];
  readonly action: { readonly label: string; readonly href: string };
  /** Shown instead of `action` to a signed-in visitor (B574, rule of #191). */
  readonly memberAction?: { readonly label: string; readonly href: string };
}

const TIER_TEXT: Record<TariffTierId, TierText> = {
  free: {
    who: 'Увидеть свой рынок',
    term: 'навсегда',
    items: [
      'Сильное резюме из вашего опыта и проверка на ATS',
      'Должности, куда вы проходите, и зарплаты по ним',
      'Вакансии со всего рынка с процентом совпадения',
      'Все отклики в одном списке',
    ],
    action: { label: 'Найти работу', href: '/signup?from=home-tariffs' },
    memberAction: { label: 'Открыть кабинет', href: '/app' },
  },
  go: {
    who: 'Резюме и письмо под каждую вакансию',
    term: 'в месяц',
    lead: 'Всё из Free, плюс:',
    items: [
      'Выход на людей внутри компании',
      'Тренажёр собеседования с ИИ',
      'Аудит профиля LinkedIn',
    ],
    action: { label: 'Выбрать Basic', href: '/signup?plan=basic&from=home' },
  },
  pro: {
    who: 'Пока openqareer откликается, вы готовитесь к встречам',
    term: 'в месяц',
    lead: 'Всё из Basic, плюс:',
    items: [
      'Отклики за вас каждый день по вашим правилам',
      'Подготовка к торгу: какую сумму назвать и как её обосновать',
      'Полная оценка переезда',
    ],
    action: { label: 'Выбрать Pro', href: '/signup?plan=pro&from=home' },
  },
  max: {
    who: 'Самая сильная модель консультанта',
    term: 'в месяц',
    lead: 'Всё из Pro, плюс:',
    items: [
      'Консультант на самой сильной модели: 3 000 ходов в месяц',
      '2 000 откликов с резюме и письмом в месяц',
      'Анонимный режим',
    ],
    action: { label: 'Выбрать Max', href: '/signup?plan=max&from=home' },
  },
  exec: {
    who: 'Для руководителей: позиции, которых нет в вакансиях',
    term: 'разово, по заявке',
    price: 'от 150 тыс. ₽',
    items: [
      'Поиск командой под ключ',
      'Закрытый рынок и рекрутеры',
      'Знакомство с работодателем через связи',
    ],
    action: { label: 'Оставить заявку', href: '/tariffs#executive-form' },
  },
};

/** Tiers in the order and with the names and prices of tariffsData.ts. */
export const HOME_TIERS: readonly HomeTier[] = TARIFF_LEVELS.map((level) => {
  const text = TIER_TEXT[level.id];
  return {
    id: level.id,
    name: level.name,
    who: text.who,
    price: text.price ?? level.price,
    term: text.term,
    ...(text.lead ? { lead: text.lead } : {}),
    items: text.items,
    action: text.action,
    ...(text.memberAction ? { memberAction: text.memberAction } : {}),
    recommended: level.id === 'pro',
  };
});

export interface HomeFaqLink {
  readonly text: string;
  readonly href: string;
}

export interface HomeFaq {
  readonly question: string;
  readonly answer: string;
  readonly links?: readonly HomeFaqLink[];
}

/** Two columns of four, as in the mockup. */
export const HOME_FAQ: readonly (readonly HomeFaq[])[] = [
  [
    {
      question: 'Что такое openqareer?',
      answer:
        'Сервис поиска работы с ИИ. Собирает вакансии с hh.ru, LinkedIn, сайтов компаний и Telegram-каналов в один список без дублей, делает резюме из вашего опыта, пишет резюме и письмо под каждую вакансию и откликается по правилам, которые вы задали.',
    },
    {
      question: 'Как составить резюме, если не умею?',
      answer:
        'Подключите LinkedIn или hh.ru, загрузите резюме или просто расскажите о себе. ИИ задаст вопросы о ваших результатах и соберёт резюме сам. Можно начать и с нуля в конструкторе резюме.',
      links: [{ text: 'конструкторе резюме', href: '/tools/resume' }],
    },
    {
      question: 'Кем я могу работать с моим опытом?',
      answer:
        'После загрузки резюме покажем должности, на которые вы проходите уже сейчас, и зарплаты по ним.',
    },
    {
      question: 'Откликается ли openqareer за меня?',
      answer:
        'Да, на тарифе Pro: по правилам, которые вы задали. Каждый отправленный отклик виден в списке, а проверку перед отправкой можно включить в любой момент.',
    },
  ],
  [
    {
      question: 'Узнает ли мой работодатель, что я ищу работу?',
      answer:
        'Нет. Ваш профиль в openqareer видите только вы, работодатели его не видят. Отклик получает только та компания, куда он отправлен.',
    },
    {
      question: 'Подходит ли, если я хочу переехать или работать удалённо?',
      answer:
        'Да: удалённые и зарубежные вакансии, расчёт зарплаты на руки в шести странах и оценка путей переезда.',
      links: [
        { text: 'расчёт зарплаты на руки', href: '/tools/salary-calculator' },
        { text: 'оценка путей переезда', href: '/tools/relocation' },
      ],
    },
    {
      question: 'Есть ли вакансии без опыта?',
      answer: 'Да, в том числе стажировки. Резюме соберём из учёбы, практики и проектов.',
    },
    {
      question: 'Сколько стоит?',
      answer: 'Free бесплатно и без срока. Платные тарифы от 3 990 ₽ в месяц.',
    },
  ],
];
