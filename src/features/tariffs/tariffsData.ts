export type TariffTierId = 'free' | 'go' | 'pro' | 'max' | 'exec';

export interface TariffLevel {
  readonly id: TariffTierId;
  readonly name: string;
  readonly sub: string;
  readonly price: string;
  readonly term: string;
  readonly promise: string;
  readonly vol: readonly string[];
  readonly auto: readonly string[];
  readonly now?: boolean;
  readonly next?: boolean;
  readonly request?: boolean;
}

export const TARIFF_NAMES: Record<TariffTierId, string> = {
  free: 'Free',
  go: 'Basic',
  pro: 'Pro',
  max: 'Max',
  exec: 'Executive',
};

export const TARIFF_LEVELS: readonly TariffLevel[] = [
  {
    id: 'free',
    name: 'Free',
    sub: 'Профиль, роли, вакансии',
    price: '0 ₽',
    term: 'без срока',
    now: true,
    promise: 'Увидеть, где вы стоите: профиль с источниками, роли и подборка вакансий.',
    vol: [
      'Профиль из LinkedIn и hh.ru, источник у каждого факта',
      'Оценка резюме',
      'Гипотезы ролей и подборка вакансий с источниками',
      'Воронка откликов вручную',
      'Консультант: 30 ходов в месяц',
    ],
    auto: [
      'Считает процент совпадения для первых 300 вакансий подборки',
      'Готовит до 20 писем к вакансиям в месяц',
    ],
  },
  {
    id: 'go',
    name: 'Basic',
    sub: 'Материалы и подготовка',
    price: '3 990 ₽',
    term: 'в месяц, автопродление',
    promise: 'Материалы под вакансию, путь к людям в компании и тренировки к интервью уже готовы.',
    vol: [
      'Резюме и письма под вакансии: 100 в месяц',
      'Консультант: 300 ходов в месяц',
      '«Хочу в компанию» до 100',
      'Путь к компании по трём кругам',
      'Мок-интервью с ИИ и STAR: 10 тренировок в месяц',
      'Проверка навыков',
      'Аудит LinkedIn и темы постов',
      'План первых 100 дней после найма',
    ],
    auto: [
      'Собирает подборку каждый день',
      'Готовит черновики откликов в очередь, ничего не отправляет',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    sub: 'Отклики на потоке',
    price: '9 900 ₽',
    term: 'в месяц, автопродление',
    next: true,
    promise:
      'Пока openqareer откликается, вы готовитесь к встречам: отклики за вас каждый день по вашим правилам.',
    vol: [
      'Всё из Basic в большем объёме: 1 000 ходов консультанта, 30 тренировок интервью',
      'Отклики за вас каждый день по вашим правилам: 500 в месяц',
      '90 черновиков LinkedIn в месяц',
      'Настройка режима: окна тишины, паузы, лимит дня',
      'Конвейер постов LinkedIn',
      'Цифровой след и Country Fit',
      'Подготовка к торгу по офферу',
      '100 дней с недельным разбором',
    ],
    auto: [
      'Очередь на одобрение и журнал с квитанциями',
      'Отправка в пределах ваших лимитов, каждый отклик виден в журнале',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    sub: 'Самая сильная модель консультанта',
    price: '39 900 ₽',
    term: 'в месяц, автопродление',
    promise: 'Всё из Pro в большем объёме и самая сильная модель консультанта.',
    vol: [
      'Всё из Pro',
      'Самая сильная модель консультанта: 3 000 ходов в месяц',
      '2 000 откликов с резюме и письмом в месяц',
      '100 тренировок интервью и 210 черновиков LinkedIn в месяц',
      'Анонимный режим',
      'Приоритет в очередях',
    ],
    auto: [
      'Готовит справку о компании к каждым воротам',
      'Напоминает о триггерах: назначено интервью, пришёл оффер',
    ],
  },
  {
    id: 'exec',
    name: 'Executive',
    sub: 'Поиск под ключ',
    price: '150–300 тыс. ₽',
    term: 'разово, купить нельзя',
    request: true,
    promise: 'Поиск командой для руководителей: скрытый рынок и представления через связи.',
    vol: [
      'Поиск под ключ силами команды',
      'Скрытый рынок и рекрутеры',
      'Представления через связи, без гарантий результата',
    ],
    auto: [
      'Ведёт процессы и напоминает о сроках',
      'Заявка попадёт в очередь команды. Срок ответа пока не подтверждён.',
    ],
  },
] as const;

export interface ComparisonStep {
  readonly title: string;
  readonly tierIndex: number;
  readonly note?: string;
  readonly isHere?: boolean;
}

export const COMPARISON_STEPS: readonly ComparisonStep[] = [
  { title: 'Профиль с источниками', tierIndex: 0 },
  { title: 'Гипотезы ролей и подборка вакансий', tierIndex: 0 },
  { title: 'Консультант с памятью', tierIndex: 1, note: 'на Free 30 ходов в месяц' },
  { title: 'Карьерный дневник и план адаптации', tierIndex: 0 },
  { title: 'Резюме и письма под вакансию', tierIndex: 1 },
  { title: '«Хочу в компанию» и путь к компании', tierIndex: 1 },
  { title: 'Мок-интервью ИИ, STAR, навыки', tierIndex: 1 },
  { title: 'LinkedIn: аудит и темы', tierIndex: 1 },
  { title: 'Отклики: черновики в очередь', tierIndex: 1, note: 'на Free вручную', isHere: true },
  { title: 'Отклики: отправка по одобрению, журнал', tierIndex: 2 },
  { title: 'Конвейер постов LinkedIn', tierIndex: 2 },
  { title: 'Цифровой след и Country Fit', tierIndex: 2 },
  { title: 'Подготовка к торгу по офферу', tierIndex: 2 },
  { title: 'Самая сильная модель консультанта', tierIndex: 3 },
  { title: 'Анонимный режим', tierIndex: 3 },
  { title: 'Скрытый рынок и представления через связи', tierIndex: 4 },
] as const;

export interface TariffSubscriptionInfo {
  readonly activeUntil: string;
  readonly autoRenew: boolean;
  readonly amount: string;
  readonly nextChargeDate: string;
  readonly paymentMethod: string;
  readonly todayUsage: {
    readonly used: number;
    readonly total: number;
  };
}
