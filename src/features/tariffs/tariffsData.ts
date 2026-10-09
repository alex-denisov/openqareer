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
      'Консультант в ограниченном объёме',
    ],
    auto: [
      'Читает источники и считает совпадение',
      'Готовит ограниченное число черновиков писем',
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
      'Резюме и письма под вакансии',
      '«Хочу в компанию» до 100',
      'Путь к компании по трём кругам',
      'Мок-интервью с ИИ и STAR, подготовка под вакансию',
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
    promise: 'Платформа берёт рутину откликов и отправляет только одобренное вами, в ваших границах.',
    vol: [
      'Всё из Basic в большем объёме',
      'Отправка откликов по вашим правилам',
      'Настройка режима: окна тишины, паузы, лимит дня',
      'Конвейер постов LinkedIn',
      'Цифровой след и Country Fit',
      'Подготовка к торгу по офферу',
      '100 дней с недельным разбором',
    ],
    auto: [
      'Очередь на одобрение и журнал с квитанциями',
      'Отправка в пределах лимитов после вашего одобрения',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    sub: 'Плюс эксперт в ключевых точках',
    price: '39 900 ₽',
    term: 'в месяц, автопродление',
    promise: 'Всё из Pro и эксперт в трёх решающих точках: резюме, интервью и оффер.',
    vol: [
      'Всё из Pro',
      'Ворота эксперта: резюме перед рассылкой, интервью, оффер',
      'Анонимный режим и контроль раскрытия',
      'Приоритет в очередях',
    ],
    auto: [
      'Готовит досье к каждым воротам',
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
      'Заявку рассматривает команда, ответ в течение недели',
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
  { title: 'Консультант с памятью', tierIndex: 1, note: 'на Free ограничен' },
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
  { title: 'Ворота эксперта: резюме, интервью, оффер', tierIndex: 3 },
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
