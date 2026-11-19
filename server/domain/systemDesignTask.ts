/**
 * B681: задача System Design под вакансию. Строится без модели из описания
 * вакансии, сохранённого в отклике (B635): предметная область по ключевым
 * словам и до трёх технологий, названных в тексте. Нет описания или область
 * не нашлась — задача строится по роли (`basis: 'role'`).
 */

export const SYSTEM_DESIGN_TIME_LIMIT_MINUTES = 45;

export type SystemDesignDomain =
  | 'payments'
  | 'notifications'
  | 'search'
  | 'marketplace'
  | 'messaging'
  | 'analytics'
  | 'logistics'
  | 'core_api';

export interface SystemDesignTaskInput {
  readonly vacancyTitle: string;
  readonly company?: string;
  readonly description?: string;
}

export interface SystemDesignTask {
  readonly prompt: string;
  readonly hint: string;
  readonly timeLimitMinutes: number;
  readonly exampleAnswer: string;
  readonly basis: 'vacancy' | 'role';
  readonly domain: SystemDesignDomain;
  readonly stack: readonly string[];
}

interface DomainSpec {
  readonly keywords: readonly string[];
  readonly service: string;
  readonly scope: string;
  readonly requirements: string;
  readonly components: string;
  readonly tradeoff: string;
  readonly operations: string;
}

const CORE_API: DomainSpec = {
  keywords: [],
  service: 'основной API продукта',
  scope: 'чтение и запись данных клиентами, авторизация и версии API',
  requirements: 'кто клиенты, какие операции чаще всего, объём данных',
  components: 'шлюз с авторизацией, сервис бизнес-логики, база данных и кэш для частых чтений',
  tradeoff: 'кэш ускоряет чтение, но данные в нём могут отставать; для изменений читаю из базы',
  operations: 'повтор запросов с идемпотентным ключом, резервная копия базы',
};

const DOMAINS: Readonly<Record<Exclude<SystemDesignDomain, 'core_api'>, DomainSpec>> = {
  payments: {
    keywords: [
      'платеж',
      'платёж',
      'биллинг',
      'billing',
      'payment',
      'эквайринг',
      'acquiring',
      'транзакц',
    ],
    service: 'сервис платежей',
    scope: 'приём оплаты, возвраты и сверка с банком без двойного списания',
    requirements: 'число платежей в секунду, пиковые часы, срок сверки с банком',
    components: 'API приёма платежа, журнал операций в базе, очередь событий для банка и сверки',
    tradeoff:
      'строгая согласованность журнала важнее скорости; уведомления клиенту идут асинхронно',
    operations: 'повтор вызова банка с идемпотентным ключом, ежедневная сверка, резерв базы',
  },
  notifications: {
    keywords: ['уведомлен', 'notification', 'push', 'пуш', 'рассылк'],
    service: 'сервис уведомлений',
    scope: 'доставка push, email и SMS с повторной отправкой и защитой от дублей',
    requirements: 'сколько сообщений в сутки, допустимая задержка доставки, каналы',
    components: 'API приёма, очередь по каналам, воркеры отправки, таблица статусов доставки',
    tradeoff: 'доставка «хотя бы один раз» плюс ключ дедупликации вместо дорогой «ровно один раз»',
    operations: 'повтор с паузой при отказе канала, отдельная очередь для ошибок',
  },
  search: {
    keywords: ['поиск', 'search', 'elasticsearch', 'ранжирован', 'opensearch'],
    service: 'сервис поиска',
    scope: 'полнотекстовый поиск с фильтрами и свежими данными',
    requirements: 'объём индекса, запросов в секунду, как быстро изменения видны в поиске',
    components:
      'индексатор из очереди изменений, поисковый индекс, API запросов с кэшем популярных',
    tradeoff: 'индекс отстаёт от базы на секунды, зато запросы не нагружают основную базу',
    operations: 'переиндексация без простоя через второй индекс, резервная реплика',
  },
  marketplace: {
    keywords: [
      'маркетплейс',
      'marketplace',
      'каталог',
      'catalog',
      'товар',
      'e-commerce',
      'ecommerce',
      'корзин',
    ],
    service: 'каталог товаров маркетплейса',
    scope: 'карточки товаров, цены и остатки продавцов, быстрый показ покупателям',
    requirements: 'число товаров и продавцов, частота смены цен, пики распродаж',
    components: 'сервис карточек, сервис цен и остатков, очередь изменений, кэш для витрины',
    tradeoff:
      'витрина читает из кэша и может показать старый остаток; при заказе остаток проверяется в базе',
    operations: 'масштабирование чтения репликами, повтор загрузки фидов продавцов',
  },
  messaging: {
    keywords: ['чат', 'мессендж', 'messenger', 'messaging', 'chat', 'переписк'],
    service: 'сервис чатов',
    scope: 'личные и групповые чаты, доставка в реальном времени и история',
    requirements: 'одновременных подключений, сообщений в секунду, срок хранения истории',
    components: 'шлюз постоянных соединений, сервис сообщений, очередь доставки, хранилище истории',
    tradeoff:
      'порядок сообщений гарантирую внутри чата, а не глобально, — так проще масштабировать',
    operations: 'повтор доставки после переподключения, резервные копии истории',
  },
  analytics: {
    keywords: [
      'аналитик',
      'analytics',
      'dwh',
      'etl',
      'pipeline',
      'пайплайн',
      'хранилище данных',
      'data platform',
      'clickhouse',
    ],
    service: 'конвейер аналитических данных',
    scope: 'сбор событий из продуктов, обработка и отчёты для бизнеса',
    requirements: 'событий в сутки, допустимая задержка отчётов, срок хранения',
    components: 'приём событий в очередь, потоковая обработка, колоночное хранилище, слой отчётов',
    tradeoff:
      'пакетная загрузка дешевле потоковой, но отчёты отстают; выбор по допустимой задержке',
    operations: 'повтор загрузки по партициям, контроль полноты данных, резерв хранилища',
  },
  logistics: {
    keywords: ['логистик', 'доставк', 'delivery', 'logistics', 'склад', 'курьер', 'маршрут'],
    service: 'сервис доставки заказов',
    scope: 'назначение курьера, статусы заказа и время прибытия для клиента',
    requirements: 'заказов в час, число курьеров, как часто обновляются координаты',
    components: 'сервис заказов, сервис назначения, приём координат через очередь, кэш позиций',
    tradeoff: 'назначение «почти лучшего» курьера за секунды вместо точной оптимизации за минуты',
    operations: 'повтор назначения при отказе курьера, резервный ручной режим диспетчера',
  },
};

const STACK_TERMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Kubernetes', /\b(?:kubernetes|k8s)\b/i],
  ['Kafka', /\bkafka\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['Redis', /\bredis\b/i],
  ['ClickHouse', /\bclickhouse\b/i],
  ['Go', /\b(?:Go|Golang|golang)\b/],
  ['Java', /\bjava\b(?!script)/i],
  ['Python', /\bpython\b/i],
  ['RabbitMQ', /\brabbitmq\b/i],
  ['MongoDB', /\bmongo(?:db)?\b/i],
  ['Elasticsearch', /\belasticsearch\b/i],
  ['gRPC', /\bgrpc\b/i],
];

function detectDomain(text: string): Exclude<SystemDesignDomain, 'core_api'> | null {
  const lower = text.toLocaleLowerCase('ru-RU');
  let best: { id: Exclude<SystemDesignDomain, 'core_api'>; hits: number } | null = null;
  for (const [id, spec] of Object.entries(DOMAINS) as Array<
    [Exclude<SystemDesignDomain, 'core_api'>, DomainSpec]
  >) {
    const hits = spec.keywords.reduce((sum, keyword) => sum + lower.split(keyword).length - 1, 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { id, hits };
  }
  return best?.id ?? null;
}

/** До трёх технологий в порядке появления в тексте. */
export function detectStack(text: string): string[] {
  return STACK_TERMS.map(([name, pattern]) => ({ name, at: text.search(pattern) }))
    .filter((term) => term.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .map((term) => term.name);
}

function exampleAnswerFor(spec: DomainSpec): string {
  return [
    `Требования: ${spec.requirements}; нагрузка и SLO по задержке фиксирую до выбора решения.`,
    `Компоненты: ${spec.components}.`,
    `Компромисс: ${spec.tradeoff}.`,
    `Эксплуатация: мониторинг, метрики и алерты на ошибки; ${spec.operations}.`,
  ].join(' ');
}

export function buildSystemDesignTask(input: SystemDesignTaskInput): SystemDesignTask {
  const description = input.description?.trim() ?? '';
  const domain = description ? detectDomain(description) : null;
  const spec = domain ? DOMAINS[domain] : CORE_API;
  const stack = description ? detectStack(description) : [];
  const company = input.company?.trim() ? ` в «${input.company.trim()}»` : '';
  const stackLine = stack.length ? ` Используйте стек из вакансии: ${stack.join(', ')}.` : '';
  return {
    prompt: `Спроектируйте ${spec.service} для «${input.vacancyTitle}»${company}: ${spec.scope}.${stackLine} Начните с требований и ограничений.`,
    hint: `Начните с вопросов о нагрузке: ${spec.requirements}.`,
    timeLimitMinutes: SYSTEM_DESIGN_TIME_LIMIT_MINUTES,
    exampleAnswer: exampleAnswerFor(spec),
    basis: domain ? 'vacancy' : 'role',
    domain: domain ?? 'core_api',
    stack,
  };
}
