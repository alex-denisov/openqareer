/**
 * B510: synthetic vacancy catalog for the local block C demo, at mockup 4 scale.
 * Every company, person and URL is invented (example.test); nothing is fetched.
 * The rows go into the real pool through `replaceSourceSlice`, so facets, the
 * summary and every estimate are computed by the server, not written here.
 */
import type {
  UnifiedVacancy,
  VacancySalary,
  VacancySourceType,
} from '../../server/domain/unifiedVacancy';

export interface BlockCSource {
  readonly id: string;
  readonly name: string;
  readonly type: VacancySourceType;
  readonly host: string;
}

export const BLOCK_C_SOURCES: readonly BlockCSource[] = [
  { id: 'src-hh-search', name: 'hh.ru', type: 'hh_search', host: 'hh.example.test' },
  { id: 'src-linkedin-guest', name: 'LinkedIn', type: 'json_api', host: 'linkedin.example.test' },
  { id: 'src-indeed', name: 'Indeed', type: 'json_api', host: 'indeed.example.test' },
  { id: 'src-habr-career', name: 'Хабр Карьера', type: 'rss', host: 'habr.example.test' },
  { id: 'src-superjob', name: 'SuperJob', type: 'json_api', host: 'superjob.example.test' },
  {
    id: 'ats-greenhouse-adyen',
    name: 'Greenhouse',
    type: 'career_site',
    host: 'greenhouse.example.test',
  },
  {
    id: 'ats-lever-activecampaign',
    name: 'Lever',
    type: 'career_site',
    host: 'lever.example.test',
  },
  { id: 'src-tg-product', name: 'Telegram-каналы', type: 'telegram', host: 't.example.test' },
];

/** Federal districts of Russia with their cities; Moscow and St Petersburg are separate. */
const RUSSIAN_CITIES: readonly string[] = [
  'Казань',
  'Екатеринбург',
  'Новосибирск',
  'Нижний Новгород',
  'Самара',
  'Уфа',
  'Пермь',
  'Ростов-на-Дону',
  'Краснодар',
  'Сочи',
  'Воронеж',
  'Волгоград',
  'Саратов',
  'Тюмень',
  'Челябинск',
  'Омск',
  'Томск',
  'Красноярск',
  'Иркутск',
  'Барнаул',
  'Хабаровск',
  'Владивосток',
  'Калининград',
  'Ярославль',
  'Тула',
  'Рязань',
  'Иннополис',
  'Ижевск',
  'Оренбург',
  'Пенза',
  'Липецк',
  'Курск',
  'Белгород',
  'Киров',
  'Чебоксары',
  'Ульяновск',
  'Тверь',
  'Мурманск',
  'Архангельск',
  'Сургут',
  'Якутск',
  'Махачкала',
];

const ABROAD: readonly string[] = [
  'San Francisco, CA, USA',
  'Los Angeles, CA, USA',
  'San Jose, CA, USA',
  'New York, NY, USA',
  'Austin, TX, USA',
  'Berlin, Germany',
  'Munich, Germany',
  'Almaty, Kazakhstan',
  'Astana, Kazakhstan',
  'London, United Kingdom',
];

const HEAD_TITLES: readonly string[] = [
  'Head of Engineering',
  'Director of Engineering',
  'Head of Platform Engineering',
  'Engineering Director',
  'Head of Backend Engineering',
  'Head of Data Engineering',
  'Head of Infrastructure',
  'Director of Platform',
  'Head of Mobile Engineering',
  'Руководитель разработки',
  'Head of QA Engineering',
  'Director of Software Engineering',
];

const OTHER_TITLES: readonly string[] = [
  'Senior Backend Developer',
  'Frontend Developer',
  'Product Manager',
  'Data Analyst',
  'DevOps Engineer',
  'QA Engineer',
  'iOS Developer',
  'Android Developer',
  'Tech Lead',
  'Team Lead Backend',
  'System Analyst',
  'Product Designer',
  'Data Scientist',
  'SRE Engineer',
  'Java Developer',
  'Go Developer',
  'Python Developer',
  'Project Manager',
  'Business Analyst',
  'Marketing Manager',
  'HR Business Partner',
  'Sales Manager',
];

const COMPANY_STEMS: readonly string[] = [
  'Вектор Банк',
  'Гринкод',
  'Арка Холдинг',
  'Финтех Про',
  'Облако+',
  'Каскад',
  'Северный Ветер',
  'Тетрис Софт',
  'Медиа Пульс',
  'Логистик Лаб',
  'Нова Ритейл',
  'Атлас Страхование',
  'Космос Телеком',
  'Ростр',
  'Квант Дата',
  'Сфера Пэй',
  'Байт Фабрика',
  'Мегаполис Девелопмент',
  'Горизонт Энерджи',
  'Пиксель Геймс',
  'Зелёный Маркет',
  'Альфа Тревел',
  'Лента Медиа',
  'Пилот Авто',
  'Сигма Здоровье',
  'Орбита Лизинг',
  'Гранит Инвест',
  'Парус Образование',
  'Маяк Безопасность',
  'Кедр Агро',
  'Нейрон Лаб',
  'Флагман Ритейл',
  'Полюс Финанс',
  'Тайга Логистик',
  'Узел Связь',
  'Эра Пэйментс',
  'Сапсан Тех',
  'Ладья Девелопмент',
  'Магистраль Транс',
  'Импульс Спорт',
  'Октава Музыка',
  'Феникс Страхование',
  'Кристалл Фарма',
  'Вершина Консалтинг',
  'Омега Робототехника',
  'Плато Недвижимость',
  'Бриз Туризм',
  'Цифра Гов',
  'Аврора Энерджи',
  'Зенит Аналитика',
  'Карта Мира',
  'Бастион Кибер',
  'Гелиос Солар',
  'Глобус Еда',
  'Терра Майнинг',
  'Вега Космос',
  'Northwind Labs',
  'Bluefin Systems',
  'Harbor Cloud',
  'Quill Payments',
  'Summit Health',
  'Riverstone AI',
];

/** Deterministic PRNG so every demo start shows the same catalog. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function blockCDescription(
  title: string,
  company: string,
  skills: readonly string[],
): string {
  return [
    `${company} ищет: ${title}.`,
    'Чем предстоит заниматься:',
    '- руководить командами разработки и наймом руководителей;',
    '- отвечать за архитектуру, надёжность и сроки поставки;',
    '- планировать бюджет направления на год.',
    // The mockup says «Что мы ждём»; the product's rule extractor knows «Что мы ожидаем».
    'Что мы ожидаем:',
    ...skills.map((skill) => `- ${skill}`),
    '- опыт управления командой от 30 человек.',
    'Условия:',
    '- оформление по ТК, ДМС, гибридный график;',
    '- годовой бонус по результатам.',
  ].join('\n');
}

interface RowInput {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly isRemote: boolean;
  readonly salary?: VacancySalary;
  readonly skills: readonly string[];
  readonly source: BlockCSource;
  readonly publishedAt: string;
}

export function blockCVacancy(row: RowInput): UnifiedVacancy {
  const url = `https://${row.source.host}/vacancy/${row.id}`;
  const description = blockCDescription(row.title, row.company, row.skills);
  return {
    id: row.id,
    fingerprint: `block-c:${row.id}`,
    title: row.title,
    company: row.company,
    location: row.location,
    isRemote: row.isRemote,
    ...(row.salary ? { salary: row.salary } : {}),
    description,
    fullDescription: description,
    requiredSkills: [...row.skills],
    url,
    provenance: {
      sourceType: row.source.type,
      sourceId: row.source.id,
      sourceName: row.source.name,
      sourceUrl: url,
      externalId: row.id,
      observedAt: row.publishedAt,
    },
    publishedAt: row.publishedAt,
    status: 'active',
  };
}

const SOURCE = Object.fromEntries(BLOCK_C_SOURCES.map((s) => [s.name, s])) as Record<
  string,
  BlockCSource
>;
const RUB = (from: number, to: number): VacancySalary => ({
  from,
  to,
  currency: 'RUR',
  gross: true,
});

const VECTOR_SKILLS = ['Engineering management', 'Платёжные системы', 'Kafka', 'Kubernetes'];

/** The rows the mockup names explicitly; ids are stable so the seed can save them. */
const FEATURED: readonly (Omit<RowInput, 'publishedAt'> & { readonly daysAgo: number })[] = [
  {
    id: 'bc-vector-head-payments',
    title: 'Head of Engineering, платёжная платформа',
    company: 'Вектор Банк',
    location: 'Москва',
    isRemote: false,
    salary: RUB(450_000, 600_000),
    skills: VECTOR_SKILLS,
    source: SOURCE['hh.ru']!,
    daysAgo: 1,
  },
  {
    id: 'bc-greencode-director',
    title: 'Director of Engineering',
    company: 'Гринкод',
    location: 'Москва',
    isRemote: false,
    salary: RUB(600_000, 750_000),
    skills: ['Engineering management', 'Go'],
    source: SOURCE['LinkedIn']!,
    daysAgo: 2,
  },
  {
    id: 'bc-arka-platform',
    title: 'Head of Platform Engineering',
    company: 'Арка Холдинг',
    location: 'Удалённо, Россия',
    isRemote: true,
    skills: ['Kubernetes', 'Engineering management'],
    source: SOURCE['hh.ru']!,
    daysAgo: 3,
  },
  {
    id: 'bc-fintechpro-lead',
    title: 'Руководитель разработки',
    company: 'Финтех Про',
    location: 'Санкт-Петербург',
    isRemote: false,
    skills: ['Java', 'Engineering management'],
    source: SOURCE['hh.ru']!,
    daysAgo: 4,
  },
  {
    id: 'bc-oblako-head',
    title: 'Head of Engineering',
    company: 'Облако+',
    location: 'Москва',
    isRemote: false,
    skills: ['Engineering management', 'Cloud'],
    source: SOURCE['LinkedIn']!,
    daysAgo: 5,
  },
];

export function featuredBlockCRows(now: Date): UnifiedVacancy[] {
  return FEATURED.map(({ daysAgo: age, ...row }) =>
    blockCVacancy({ ...row, publishedAt: daysAgo(now, age) }),
  );
}

const CATALOG_SIZE = 1_620;
/** Team suffixes keep «role × company» rows distinct, so the pool does not merge them into one cluster. */
const TEAMS: readonly string[] = [
  '',
  ', платежи',
  ', B2B',
  ', маркетплейс',
  ', облако',
  ', антифрод',
  ', мобильный банк',
  ', логистика',
];
/** Head/Director rows; about two thirds match the demo roles, as 214 do in the mockup. */
const HEAD_SHARE = 355;
/** The first stems are the mockup's named rows; generated rows never repeat them. */
const FEATURED_COMPANIES = 5;

function locationFor(random: () => number, index: number): { location: string; isRemote: boolean } {
  const bucket = index % 10;
  if (bucket < 4) return { location: 'Москва', isRemote: false };
  if (bucket === 4) return { location: 'Санкт-Петербург', isRemote: false };
  if (bucket === 5) return { location: 'Удалённо, Россия', isRemote: true };
  if (bucket < 9) return { location: pick(random, RUSSIAN_CITIES), isRemote: false };
  return { location: pick(random, ABROAD), isRemote: false };
}

/**
 * Salaries: Moscow head roles mostly state one (sample ≥ 20 for a market
 * estimate); «Head of Data Engineering» and abroad rows almost never do, so
 * those read «мало данных».
 */
function salaryFor(
  random: () => number,
  title: string,
  location: string,
): VacancySalary | undefined {
  if (/Data Engineering|QA Engineering/u.test(title))
    return random() < 0.1 ? RUB(380_000, 480_000) : undefined;
  if (/, (USA|Germany|Kazakhstan|United Kingdom)$/u.test(location)) return undefined;
  const head = HEAD_TITLES.some((headTitle) => title.startsWith(headTitle));
  if (random() > (location === 'Москва' ? 0.75 : 0.45)) return undefined;
  const base = head
    ? 380_000 + Math.round(random() * 30) * 10_000
    : 150_000 + Math.round(random() * 25) * 10_000;
  return RUB(base, base + 100_000 + Math.round(random() * 10) * 10_000);
}

/** The whole catalog, grouped by source id as the pool stores it. */
export function buildBlockCCatalog(now: Date): Map<string, UnifiedVacancy[]> {
  const random = mulberry32(510);
  const rows: UnifiedVacancy[] = featuredBlockCRows(now);
  for (let index = rows.length; index < CATALOG_SIZE; index += 1) {
    const head = index < HEAD_SHARE;
    const title = head
      ? `${HEAD_TITLES[index % HEAD_TITLES.length]!}${TEAMS[Math.floor(index / HEAD_TITLES.length) % TEAMS.length]!}`
      : pick(random, OTHER_TITLES);
    const company =
      COMPANY_STEMS[FEATURED_COMPANIES + (index % (COMPANY_STEMS.length - FEATURED_COMPANIES))]!;
    const place = locationFor(random, index);
    const salary = salaryFor(random, title, place.location);
    rows.push(
      blockCVacancy({
        id: `bc-${String(index).padStart(4, '0')}`,
        title,
        company,
        ...place,
        ...(salary ? { salary } : {}),
        skills: head
          ? [
              'Engineering management',
              pick(random, ['Kafka', 'Kubernetes', 'Go', 'Java', 'Платёжные системы']),
            ]
          : [pick(random, ['Go', 'Java', 'Python', 'SQL', 'React', 'Figma'])],
        source: BLOCK_C_SOURCES[index % BLOCK_C_SOURCES.length]!,
        // The pool reads its 500 freshest candidates first (DEFAULT_MATCH_CANDIDATE_LIMIT);
        // head rows are newer so the matched selection reaches the mockup's scale.
        publishedAt: daysAgo(now, head ? 1 + (index % 9) : 10 + (index % 18)),
      }),
    );
  }
  const bySource = new Map<string, UnifiedVacancy[]>();
  for (const row of rows) {
    const list = bySource.get(row.provenance.sourceId) ?? [];
    bySource.set(row.provenance.sourceId, [...list, row]);
  }
  return bySource;
}
