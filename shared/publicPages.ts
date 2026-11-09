/**
 * Реестр постоянных публичных страниц (GEO 09.11). Из него собираются
 * `static-1.xml` в sitemap и раздел «Все страницы» в `/llms.txt`: страница,
 * добавленная сюда, попадает в оба места, а тест `publicPages.test.ts` не
 * пропустит адрес sitemap без строки в llms.txt или запись без описания.
 *
 * Страницы из базы (месячные отчёты рынка) приходят тем же типом через
 * `extraPages` и проходят ту же проверку.
 */
import { LEGAL_DOCS, LEGAL_PACK_PUBLISHED_AT, legalPath } from './legalRegistry';
import { GUIDES, GUIDES_ROOT, guidePath } from './guides';
import { BLOG_POSTS, BLOG_ROOT, blogPath } from './blog';
import {
  INTERVIEW_EVIDENCE,
  INTERVIEW_HUB_PATH,
  interviewProfessionIndexable,
  interviewProfessionPath,
  publishedInterviewProfessions,
} from './interviewQuestions';
import { SALARY_COUNTRIES, SALARY_POOL_COUNTRIES } from './salaryPublicPages';
import { CATALOG_ROOT } from './vacancyCatalogRoutes';

/** Same slug as `RELOCATION_PLACE` in server/vacancies/catalogChips. */
const RELOCATION_LISTING = `${CATALOG_ROOT}/relocation`;

export interface PublicPage {
  readonly path: string;
  readonly title: string;
  /** Одна строка: что на странице. Без неё страница не публикуется. */
  readonly description: string;
  /** `YYYY-MM-DD`; без даты — только у страниц, чья дата приходит из базы. */
  readonly updatedAt?: string;
  /** Раздел в llms.txt. */
  readonly group: PublicPageGroup;
  /** Дата берётся из самой свежей вакансии каталога, а не из кода. */
  readonly datedByCatalog?: true;
}

export type PublicPageGroup =
  | 'Продукт'
  | 'Инструменты'
  | 'Материалы для кандидата'
  | 'Блог'
  | 'Вопросы на собеседовании'
  | 'Зарплаты'
  | 'Отчёты о рынке'
  | 'Правовые документы';

/** Последнее изменение лендинга и страниц помощи (B535). */
export const PUBLIC_PAGES_UPDATED_AT = '2026-10-20';

function newest(dates: readonly string[]): string | undefined {
  return [...dates].sort().at(-1);
}

function interviewPages(): PublicPage[] {
  const updatedAt = INTERVIEW_EVIDENCE.measuredAt;
  return [
    {
      path: INTERVIEW_HUB_PATH,
      title: 'Вопросы на собеседовании по профессиям',
      description:
        'Вопросы работодателей с разбором сильного ответа; у темы — доля вакансий каталога за 90 дней, где она встречается.',
      updatedAt,
      group: 'Вопросы на собеседовании',
    },
    ...publishedInterviewProfessions()
      .filter(interviewProfessionIndexable)
      .map((profession) => ({
        path: interviewProfessionPath(profession.slug),
        title: `Вопросы на собеседовании ${profession.genitive}`,
        description: `Вопросы на собеседовании ${profession.genitive}: что проверяет работодатель и как звучит сильный ответ.`,
        updatedAt,
        group: 'Вопросы на собеседовании' as const,
      })),
  ];
}

function salaryPages(): PublicPage[] {
  return [
    ...Object.entries(SALARY_COUNTRIES).map(([slug, country]) => ({
      path: `/salaries/${slug}`,
      title: `Зарплаты ${country.in}`,
      description: `Сколько остаётся на руки ${country.in} по ставкам 2026 года и вилки из открытых вакансий.`,
      updatedAt: '2026-10-27',
      group: 'Зарплаты' as const,
    })),
    ...Object.entries(SALARY_POOL_COUNTRIES).map(([slug, country]) => ({
      path: `/salaries/${slug}`,
      title: `Зарплаты ${country.in}`,
      description: `Медиана опубликованных зарплатных вилок ${country.in} из открытых вакансий, с выборкой и датой.`,
      group: 'Зарплаты' as const,
    })),
  ];
}

/** Постоянные страницы. Порядок — порядок в sitemap. */
export function publicPages(): PublicPage[] {
  return [
    {
      path: '/',
      title: 'openqareer — поиск работы с ИИ',
      description:
        'Рабочее место кандидата: профиль по фактам, роли с опорой на опыт, вакансии из десятков источников и следующий шаг.',
      updatedAt: PUBLIC_PAGES_UPDATED_AT,
      group: 'Продукт',
    },
    {
      path: '/faq',
      title: 'Вопросы и ответы',
      description: 'Ответы на частые вопросы о поиске работы и о том, как устроен openqareer.',
      updatedAt: PUBLIC_PAGES_UPDATED_AT,
      group: 'Продукт',
    },
    {
      path: '/support',
      title: 'Поддержка',
      description: 'Как связаться с поддержкой openqareer и что приложить к обращению.',
      updatedAt: PUBLIC_PAGES_UPDATED_AT,
      group: 'Продукт',
    },
    {
      path: '/tariffs',
      title: 'Тарифы',
      description: 'Тарифы Free, Basic, Pro, Max и Executive: цена и что входит в каждый.',
      updatedAt: '2026-10-27',
      group: 'Продукт',
    },
    {
      path: '/tools/country-fit',
      title: 'Country Fit: зарплата на руки по странам',
      description:
        'Ориентировочный расчёт налогов и чистой зарплаты наёмного работника по ставкам 2026 года; не налоговая консультация.',
      updatedAt: '2026-10-23',
      group: 'Инструменты',
    },
    {
      path: '/tools/resume',
      title: 'Конструктор резюме',
      description:
        'Три шаблона резюме и проверка на ATS без регистрации; PDF и DOCX — после бесплатной регистрации.',
      updatedAt: '2026-10-27',
      group: 'Инструменты',
    },
    ...interviewPages(),
    {
      path: GUIDES_ROOT,
      title: 'Материалы для кандидата',
      description:
        'Разборы частых трудностей поиска работы: резюме, сопроводительное письмо, отклики.',
      updatedAt: newest(GUIDES.map((guide) => guide.updatedAt)),
      group: 'Материалы для кандидата',
    },
    ...GUIDES.map((guide) => ({
      path: guidePath(guide.slug),
      title: guide.h1,
      description: guide.description,
      updatedAt: guide.updatedAt,
      group: 'Материалы для кандидата' as const,
    })),
    {
      path: BLOG_ROOT,
      title: 'Блог openqareer',
      description: 'Статьи о поиске работы, собеседованиях, оффере и испытательном сроке.',
      updatedAt: newest(BLOG_POSTS.map((post) => post.updatedAt)),
      group: 'Блог',
    },
    ...BLOG_POSTS.map((post) => ({
      path: blogPath(post.slug),
      title: post.h1,
      description: post.description,
      updatedAt: post.updatedAt,
      group: 'Блог' as const,
    })),
    {
      path: '/tools/relocation',
      title: 'В какую страну переехать',
      description:
        'Лучший проверенный путь переезда по работе для выбранных стран: требования со ссылкой на официальный источник.',
      updatedAt: '2026-10-27',
      group: 'Инструменты',
    },
    {
      path: '/tools/salary-calculator',
      title: 'Калькулятор зарплаты на руки',
      description: 'Сколько останется от зарплаты после налогов и взносов по ставкам 2026 года.',
      updatedAt: '2026-10-28',
      group: 'Инструменты',
    },
    {
      path: CATALOG_ROOT,
      title: 'Каталог вакансий',
      description:
        'Открытый каталог вакансий: карточка называет работодателя, место, источник и дату наблюдения.',
      group: 'Продукт',
      datedByCatalog: true,
    },
    {
      path: RELOCATION_LISTING,
      title: 'Вакансии с релокацией',
      description: 'Вакансии, где работодатель пишет о помощи с переездом, с источником и датой.',
      group: 'Продукт',
      datedByCatalog: true,
    },
    ...LEGAL_DOCS.map((doc) => ({
      path: legalPath(doc.slug),
      title: doc.title,
      description: doc.description,
      updatedAt: LEGAL_PACK_PUBLISHED_AT,
      group: 'Правовые документы' as const,
    })),
  ];
}

/** Страницы sitemap зарплат, которые не зависят от базы. */
export function salaryPublicPages(): PublicPage[] {
  return salaryPages();
}

const GROUP_ORDER: readonly PublicPageGroup[] = [
  'Продукт',
  'Инструменты',
  'Материалы для кандидата',
  'Блог',
  'Вопросы на собеседовании',
  'Зарплаты',
  'Отчёты о рынке',
  'Правовые документы',
];

/** Раздел llms.txt: строка на страницу — ссылка, описание, дата обновления. */
export function renderPublicPagesSection(origin: string, pages: readonly PublicPage[]): string[] {
  return GROUP_ORDER.flatMap((group) => {
    const rows = pages.filter((page) => page.group === group);
    if (rows.length === 0) return [];
    return [
      `### ${group}`,
      '',
      ...rows.map(
        (page) =>
          `- [${page.title}](${origin}${page.path}) — ${page.description}${
            page.updatedAt ? ` Обновлено: ${page.updatedAt}.` : ''
          }`,
      ),
      '',
    ];
  });
}
