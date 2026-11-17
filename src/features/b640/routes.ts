/**
 * B649: адреса 72 узлов карты экранов B640. Один узел — один адрес под `/app`.
 * Файл заморожен после волны 1: раздел правит только свой каталог, новая строка
 * здесь — отдельным PR через оркестратора.
 */

/** Каталог раздела в `src/features/b640/<раздел>/`. */
export const B640_SECTIONS = [
  'today',
  'profile',
  'footprint',
  'career',
  'vacancies',
  'companies',
  'platforms',
  'responses',
  'apply',
  'offers',
  'interview',
  'consultant',
  'account',
  'diary',
  'adaptation',
] as const;
export type B640Section = (typeof B640_SECTIONS)[number];

/** Пункт навигации, который подсвечен на экране узла. */
export type B640Nav =
  | 'today'
  | 'profile'
  | 'career'
  | 'vacancies'
  | 'responses'
  | 'diary'
  | 'settings'
  | 'tariffs'
  | 'bell';

/** Шаблон страницы из макета (`data-template`). */
export type B640Template = 'desk' | 'list' | 'object' | 'focus' | 'settings';

export type B640TabSetId = 'profile' | 'career' | 'vacancies' | 'responses' | 'diary' | 'account';

export interface B640Node {
  /** Код узла на карте: `s03`, `o01c`. */
  readonly code: string;
  /** Имя файла макета без расширения. */
  readonly slug: string;
  readonly section: B640Section;
  readonly nav: B640Nav | null;
  /** Адрес; `:имя` — параметр. */
  readonly path: string;
  /** Заголовок в верхней полосе. */
  readonly title: string;
  readonly template: B640Template;
  /** Узел уровнем выше: из цепочки строится путь и «Назад». */
  readonly parent?: string;
  /** Подпись звена пути, если она не совпадает с заголовком. */
  readonly crumb?: string;
  /** Вкладки раздела над страницей. */
  readonly tabs?: B640TabSetId;
  /** Какая вкладка подсвечена, если не своя: узел живёт внутри чужой вкладки. */
  readonly tabOf?: string;
}

type NodeRow = readonly [
  code: string,
  slug: string,
  section: B640Section,
  nav: B640Nav | null,
  path: string,
  title: string,
  template: B640Template,
  extra?: { parent?: string; crumb?: string; tabs?: B640TabSetId; tabOf?: string },
];

const ROWS: readonly NodeRow[] = [
  // Сегодня и уведомления
  ['s03', 's03-segodnya-posle-smeny', 'today', 'today', '/app/today', 'Сегодня', 'desk'],
  ['n01b', 'n01b-vse-uvedomleniya', 'today', 'settings', '/app/notifications', 'Все уведомления', 'list', { parent: 'n02', tabs: 'account', tabOf: 'n02' }],
  // Профиль
  ['s01', 's01-profil-status', 'profile', 'profile', '/app/profile', 'Профиль', 'object', { tabs: 'profile' }],
  ['s02', 's02-status-vybor', 'profile', 'profile', '/app/profile/status', 'Статус', 'focus', { parent: 's01', crumb: 'Статус поиска' }],
  ['p04', 'p04-otkuda-vzyat-opyt', 'profile', 'profile', '/app/profile/sources', 'Профиль', 'focus', { parent: 's01', crumb: 'Откуда взять опыт' }],
  ['p06', 'p06-proverte-zapisi', 'profile', 'profile', '/app/profile/review', 'Профиль', 'focus', { parent: 's01', crumb: 'Проверка записей' }],
  ['p07', 'p07-pravka-mesta-raboty', 'profile', 'profile', '/app/profile/experience/:entryId', 'Профиль', 'focus', { parent: 'p06', crumb: 'Место работы' }],
  ['p08', 'p08-foto', 'profile', 'profile', '/app/profile/photo', 'Профиль', 'focus', { parent: 's01', crumb: 'Фото' }],
  ['p09', 'p09-dobor-odnim-voprosom', 'profile', 'profile', '/app/profile/question', 'Профиль', 'focus', { parent: 's01', crumb: 'Уточнение профиля' }],
  ['p10', 'p10-istoriya-izmenenij', 'profile', 'profile', '/app/profile/history', 'Профиль', 'list', { tabs: 'profile', crumb: 'История изменений' }],
  ['p11', 'p11-svyazi', 'profile', 'profile', '/app/profile/connections', 'Связи', 'list', { parent: 's01' }],
  // Цифровой след
  ['p02', 'p02-profil-cifrovoj-sled', 'footprint', 'profile', '/app/profile/footprint', 'Профиль', 'list', { tabs: 'profile', crumb: 'Цифровой след' }],
  ['f01', 'f01-cifrovoj-sled-do-poiska', 'footprint', 'profile', '/app/profile/footprint/start', 'Профиль', 'list', { tabs: 'profile', crumb: 'Цифровой след', tabOf: 'p02' }],
  ['f03', 'f03-razbor-po-odnoj', 'footprint', 'profile', '/app/profile/footprint/findings', 'Профиль', 'focus', { parent: 'p02', crumb: 'Сводка' }],
  ['f03b', 'f03b-nahodka-put-udaleniya', 'footprint', 'profile', '/app/profile/footprint/findings/:findingId', 'Профиль', 'focus', { parent: 'f03', crumb: 'Находка' }],
  // Карьера
  ['s09', 's09-karera-ishchu', 'career', 'career', '/app/career', 'Карьера', 'object', { tabs: 'career' }],
  ['s10', 's10-karera-ishchu-kem', 'career', 'career', '/app/career/roles', 'Карьера', 'focus', { tabs: 'career', tabOf: 's09' }],
  ['s11', 's11-karera-menyayu', 'career', 'career', '/app/career/change', 'Карьера', 'object', { tabs: 'career', tabOf: 's09' }],
  ['s12', 's12-karera-rabotayu', 'career', 'career', '/app/career/growth', 'Карьера', 'object', { tabs: 'career', tabOf: 's09' }],
  ['c04', 'c04-proverka-navykov', 'career', 'career', '/app/career/skills', 'Карьера', 'focus', { parent: 's09', crumb: 'Проверка навыков' }],
  ['c06', 'c06-relokaciya', 'career', 'career', '/app/career/relocation', 'Карьера', 'list', { tabs: 'career', crumb: 'Релокация' }],
  // Вакансии
  ['s07', 's07-vakansii-ishchu', 'vacancies', 'vacancies', '/app/vacancies', 'Вакансии', 'list', { tabs: 'vacancies' }],
  ['v06s', 'v06s-sohranennye', 'vacancies', 'vacancies', '/app/vacancies/saved', 'Вакансии', 'list', { tabs: 'vacancies', crumb: 'Сохранённые' }],
  ['v04', 'v04-kartochka-vakansii', 'vacancies', 'vacancies', '/app/vacancies/:vacancyId', 'Вакансия', 'object', { parent: 's07' }],
  // Компании и люди
  ['v10', 'v10-kompanii-i-lyudi', 'companies', 'vacancies', '/app/vacancies/companies', 'Вакансии', 'list', { tabs: 'vacancies', parent: 's07', crumb: 'Компании и люди' }],
  ['v10b', 'v10b-kompaniya-ladoga', 'companies', 'vacancies', '/app/vacancies/companies/:companyId', 'Компания', 'object', { parent: 'v10' }],
  // Профиль: LinkedIn, hh.ru, Контакты, Журнал
  ['a03', 'a03-linkedin-profil-i-posty', 'platforms', 'profile', '/app/profile/linkedin', 'Профиль', 'desk', { tabs: 'profile', crumb: 'LinkedIn' }],
  ['a03b', 'a03b-linkedin-posty', 'platforms', 'profile', '/app/profile/linkedin/posts', 'Профиль', 'desk', { tabs: 'profile', crumb: 'Посты', tabOf: 'a03' }],
  ['a03p', 'a03p-linkedin-publikacii', 'platforms', 'profile', '/app/profile/linkedin/published', 'Профиль', 'list', { tabs: 'profile', crumb: 'Публикации', tabOf: 'a03' }],
  ['a05', 'a05-radar-lenty', 'platforms', 'profile', '/app/profile/linkedin/feed', 'Профиль', 'focus', { tabs: 'profile', crumb: 'Лента', tabOf: 'a03' }],
  ['a11', 'a11-hh-rezyume', 'platforms', 'profile', '/app/profile/hh', 'Профиль', 'desk', { tabs: 'profile', crumb: 'hh.ru' }],
  ['a02', 'a02-rekrutery-i-kontakty', 'platforms', 'profile', '/app/profile/contacts', 'Профиль', 'list', { tabs: 'profile', crumb: 'Контакты' }],
  ['a05c', 'a05c-linkedin-zhurnal', 'platforms', 'profile', '/app/profile/journal', 'Профиль', 'focus', { tabs: 'profile', crumb: 'Журнал' }],
  // Отклики
  ['o01', 'o01-otkliki', 'responses', 'responses', '/app/responses', 'Отклики', 'list', { tabs: 'responses' }],
  ['o01e', 'o01e-voronka', 'responses', 'responses', '/app/responses/funnel', 'Отклики', 'object', { tabs: 'responses', crumb: 'Воронка' }],
  ['o07', 'o07-razbor-voronki', 'responses', 'responses', '/app/responses/review', 'Разбор откликов', 'focus', { tabs: 'responses', crumb: 'Разбор отказов' }],
  ['o08', 'o08-hochu-v-kompaniyu', 'responses', 'responses', '/app/responses/wanted', 'Отклики', 'list', { tabs: 'responses', crumb: 'Хочу в компанию' }],
  ['o01c', 'o01c-otklik-raskryt', 'responses', 'responses', '/app/responses/:responseId', 'Отклик', 'list', { parent: 'o01' }],
  // Единый отклик
  ['o02', 'o02-pismo', 'apply', 'responses', '/app/responses/:responseId/letter', 'Письмо', 'focus', { parent: 'o01c' }],
  // Офферы
  ['o06', 'o06-offery', 'offers', 'responses', '/app/responses/offers', 'Офферы', 'focus', { parent: 'o01' }],
  ['o06a', 'o06a-usloviya-offera', 'offers', 'responses', '/app/responses/offers/:offerId', 'Офферы', 'focus', { parent: 'o06', crumb: 'Оффер' }],
  // Подготовка и интервью
  ['i01', 'i01-podgotovka-k-intervyu', 'interview', 'responses', '/app/responses/:responseId/interview', 'Интервью', 'object', { parent: 'o01c', crumb: 'Подготовка к интервью' }],
  ['i02', 'i02-probnoe-intervyu', 'interview', 'responses', '/app/responses/:responseId/interview/mock', 'Пробное интервью', 'focus', { parent: 'o01c' }],
  ['i03', 'i03-trenirovka-system-design', 'interview', 'responses', '/app/responses/:responseId/interview/practice', 'System Design', 'focus', { parent: 'i01' }],
  ['i04', 'i04-razbor-posle-intervyu', 'interview', 'responses', '/app/responses/:responseId/debrief', 'Разбор интервью', 'focus', { parent: 'o01c' }],
  ['i04b', 'i04b-zapis-v-prilozhenii', 'interview', 'responses', '/app/responses/:responseId/debrief/record', 'Запись интервью', 'focus', { parent: 'i04' }],
  ['i04c', 'i04c-zagruzka-i-golosa', 'interview', 'responses', '/app/responses/:responseId/debrief/upload', 'Загрузка записи', 'focus', { parent: 'i04' }],
  // Консультант
  ['k01', 'k01-konsultant-dialog', 'consultant', null, '/app/consultant', 'Консультант', 'list'],
  ['k05', 'k05-konsultant-istoriya', 'consultant', null, '/app/consultant/history', 'Консультант', 'list', { parent: 'k01', crumb: 'История разговоров' }],
  // Аккаунт и тарифы
  ['n00', 'n00-akkaunt-razdely', 'account', 'settings', '/app/account', 'Аккаунт', 'list'],
  ['n03', 'n03-akkaunt', 'account', 'settings', '/app/account/connections', 'Подключения', 'settings', { parent: 'n00', tabs: 'account' }],
  ['n02', 'n02-nastrojki-uvedomlenij', 'account', 'settings', '/app/account/notifications', 'Уведомления', 'settings', { parent: 'n00', tabs: 'account' }],
  ['n04', 'n04-vhod-i-bezopasnost', 'account', 'settings', '/app/account/security', 'Вход и безопасность', 'settings', { parent: 'n00', tabs: 'account' }],
  ['n05', 'n05-soglasiya-i-dannye', 'account', 'settings', '/app/account/data', 'Аккаунт', 'settings', { parent: 'n00', tabs: 'account', crumb: 'Согласия и данные' }],
  ['t03', 't03-podpiska-i-oplata', 'account', 'tariffs', '/app/account/billing', 'Подписка', 'settings', { parent: 'n00', tabs: 'account', crumb: 'Подписка и оплата' }],
  ['n06', 'n06-prilozhenie', 'account', 'settings', '/app/account/app', 'Приложение', 'settings', { parent: 'n00', tabs: 'account' }],
  ['t01', 't01-tarify', 'account', 'tariffs', '/app/tariffs', 'Тарифы', 'focus'],
  // Дневник
  ['d00', 'd00-zapisi', 'diary', 'diary', '/app/diary', 'Дневник', 'list', { tabs: 'diary' }],
  ['d00d', 'd00d-itog-nedeli', 'diary', 'diary', '/app/diary/week', 'Дневник', 'object', { parent: 'd00', crumb: 'Итог недели' }],
  ['d02', 'd02-celi-i-kpi', 'diary', 'diary', '/app/diary/goals', 'Дневник', 'object', { tabs: 'diary', parent: 'd00', crumb: 'Цели и показатели' }],
  ['d02b', 'd02b-novaya-cel', 'diary', 'diary', '/app/diary/goals/new', 'Новая цель', 'focus', { parent: 'd02' }],
  ['d02k', 'd02k-zagruzit-kpi', 'diary', 'diary', '/app/diary/goals/import', 'Загрузить KPI', 'focus', { parent: 'd02' }],
  ['d02l', 'd02l-proverte-kpi', 'diary', 'diary', '/app/diary/goals/import/review', 'Проверка KPI', 'focus', { parent: 'd02k', crumb: 'Проверьте, как мы поняли' }],
  ['d02a', 'd02a-kartochka-celi', 'diary', 'diary', '/app/diary/goals/:goalId', 'Цели и показатели', 'object', { parent: 'd02', crumb: 'Цель' }],
  // Адаптация и итоги
  ['d01', 'd01-plan-30-60-90', 'adaptation', 'diary', '/app/diary/adaptation', 'Дневник', 'object', { tabs: 'diary', parent: 'd00', crumb: 'Адаптация' }],
  ['d01a', 'd01a-do-vyhoda', 'adaptation', 'diary', '/app/diary/adaptation/before-start', 'Адаптация', 'object', { parent: 'd01', crumb: 'До выхода' }],
  ['d01b', 'd01b-pervye-dve-nedeli', 'adaptation', 'diary', '/app/diary/adaptation/first-weeks', 'Адаптация', 'object', { parent: 'd01', crumb: 'Первые две недели' }],
  ['d01c', 'd01c-vstrecha-s-rukovoditelem', 'adaptation', 'diary', '/app/diary/adaptation/manager-meeting', 'Адаптация', 'object', { parent: 'd01', crumb: 'Первая встреча с руководителем' }],
  ['d01d', 'd01d-karta-lyudej', 'adaptation', 'diary', '/app/diary/adaptation/people', 'Адаптация', 'object', { parent: 'd01', crumb: 'Карта людей' }],
  ['d01e', 'd01e-proverka-30-dnya', 'adaptation', 'diary', '/app/diary/adaptation/day-30', 'Адаптация', 'object', { parent: 'd01', crumb: 'Проверка на 30-й день' }],
  ['d01f', 'd01f-obustrojstvo', 'adaptation', 'diary', '/app/diary/adaptation/settling', 'Адаптация', 'object', { parent: 'd01', crumb: 'Обустройство' }],
  ['d04', 'd04-itog-90-dnej', 'adaptation', 'diary', '/app/diary/results', 'Дневник', 'object', { tabs: 'diary', crumb: 'Итоги' }],
];

export const B640_NODES: readonly B640Node[] = ROWS.map(
  ([code, slug, section, nav, path, title, template, extra]) => ({
    code,
    slug,
    section,
    nav,
    path,
    title,
    template,
    ...extra,
  }),
);

export interface B640Tab {
  readonly label: string;
  /** Подпись на 390, если полная не помещается: начало полной («Компании» у «Компании и люди»). */
  readonly shortLabel?: string;
  readonly code: string;
  /** Параметры адреса, если вкладка ведёт на узел с параметром. */
  readonly params?: Readonly<Record<string, string>>;
}

export interface B640TabSet {
  /** Подпись навигации для чтения с экрана. */
  readonly label: string;
  readonly tabs: readonly B640Tab[];
  /** Дополнительные классы строки вкладок из макета. */
  readonly className?: string;
  /** На 390 вкладки заменяет экран-список: «Назад» ведёт на него. */
  readonly mobileHub?: string;
}

export const B640_TAB_SETS: Readonly<Record<B640TabSetId, B640TabSet>> = {
  profile: {
    label: 'Разделы профиля',
    tabs: [
      { label: 'Опыт', code: 's01' },
      { label: 'Цифровой след', code: 'p02' },
      { label: 'LinkedIn', code: 'a03' },
      { label: 'hh.ru', code: 'a11' },
      { label: 'Контакты', code: 'a02' },
      { label: 'Журнал', code: 'a05c' },
      { label: 'История изменений', code: 'p10' },
    ],
  },
  career: {
    label: 'Разделы карьеры',
    tabs: [
      { label: 'Роли', code: 's09' },
      { label: 'Проверка навыков', code: 'c04' },
      { label: 'Релокация', code: 'c06' },
    ],
  },
  vacancies: {
    label: 'Разделы вакансий',
    tabs: [
      { label: 'Подборка', code: 's07' },
      { label: 'Сохранённые', code: 'v06s' },
      { label: 'Компании и люди', shortLabel: 'Компании', code: 'v10' },
    ],
  },
  responses: {
    label: 'Разделы откликов',
    tabs: [
      { label: 'Отклики', code: 'o01' },
      { label: 'Воронка', code: 'o01e' },
      { label: 'Разбор отказов', code: 'o07' },
      { label: 'Хочу в компанию', code: 'o08' },
      // «next» — ближайшее интервью: раздел сам находит отклик.
      { label: 'Подготовка', code: 'i01', params: { responseId: 'next' } },
      { label: 'Офферы', code: 'o06' },
    ],
  },
  diary: {
    label: 'Разделы дневника',
    tabs: [
      { label: 'Записи', code: 'd00' },
      { label: 'Цели и показатели', code: 'd02' },
      { label: 'Адаптация', code: 'd01' },
      { label: 'Итоги', code: 'd04' },
    ],
  },
  account: {
    label: 'Разделы аккаунта',
    className: 'tabs acct-tabs',
    mobileHub: 'n00',
    tabs: [
      { label: 'Подключения', code: 'n03' },
      { label: 'Уведомления', code: 'n02' },
      { label: 'Вход и безопасность', code: 'n04' },
      { label: 'Согласия и данные', code: 'n05' },
      { label: 'Подписка', code: 't03' },
      { label: 'Приложение', code: 'n06' },
    ],
  },
};

/** Корень кабинета и адрес витрины общих компонентов. */
export const B640_HOME_PATH = '/app/today';
export const B640_KIT_PATH = '/app/kit';

const NODE_BY_CODE = new Map(B640_NODES.map((node) => [node.code, node]));

export function nodeByCode(code: string): B640Node | undefined {
  return NODE_BY_CODE.get(code);
}

export interface B640Match {
  readonly node: B640Node;
  readonly params: Readonly<Record<string, string>>;
}

function segmentsOf(path: string): string[] {
  return path.split(/[?#]/u)[0].split('/').filter(Boolean);
}

const COMPILED = B640_NODES.map((node) => ({ node, segments: segmentsOf(node.path) }));

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Из двух подходящих адресов важнее тот, у кого точное звено стоит раньше. */
function moreExact(candidate: readonly string[], best: readonly string[]): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    const exact = !candidate[index].startsWith(':');
    if (exact !== !best[index].startsWith(':')) return exact;
  }
  return false;
}

/**
 * Узел по адресу. Точное звено важнее параметра, считая слева: `/vacancies/saved`
 * — не вакансия, `/responses/offers/…` — всегда офферы, а не отклик с таким кодом.
 */
export function matchNode(path: string): B640Match | null {
  const segments = segmentsOf(path);
  if (segments.length === 1 && segments[0] === 'app') {
    const home = NODE_BY_CODE.get('s03');
    return home ? { node: home, params: {} } : null;
  }
  let best: (B640Match & { segments: readonly string[] }) | null = null;
  for (const candidate of COMPILED) {
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = candidate.segments.every((expected, index) => {
      if (!expected.startsWith(':')) return expected === segments[index];
      params[expected.slice(1)] = safeDecode(segments[index]);
      return true;
    });
    if (fits && (!best || moreExact(candidate.segments, best.segments))) {
      best = { node: candidate.node, params, segments: candidate.segments };
    }
  }
  return best ? { node: best.node, params: best.params } : null;
}

/** Адрес узла; параметр без значения — ошибка вызывающего кода. */
export function buildNodePath(code: string, params: Readonly<Record<string, string>> = {}): string {
  const node = NODE_BY_CODE.get(code);
  if (!node) throw new Error(`B640: нет узла ${code}`);
  return node.path.replace(/:([A-Za-z]+)/gu, (_, name: string) => {
    const value = params[name];
    if (!value) throw new Error(`B640: узлу ${code} нужен параметр ${name}`);
    return encodeURIComponent(value);
  });
}

/** Цепочка от корня раздела до узла: звенья пути вложенного экрана. */
export function crumbTrail(code: string): readonly B640Node[] {
  const trail: B640Node[] = [];
  const seen = new Set<string>();
  let current = NODE_BY_CODE.get(code);
  while (current && !seen.has(current.code)) {
    seen.add(current.code);
    trail.unshift(current);
    current = current.parent ? NODE_BY_CODE.get(current.parent) : undefined;
  }
  return trail;
}

export function crumbLabel(node: B640Node): string {
  return node.crumb ?? node.title;
}
