/**
 * B535: content of the public site (landing, /faq, /support), approved by the
 * owner as mockup v18 (docs/v1-release/tasks/work/landing-redesign/). Copy is
 * owner-approved verbatim; FAQ answers come from the product, tariffsData.ts
 * and the published privacy policy. No company names of real vacancies, no
 * long dashes, no invented metrics or support response times.
 */
import { TARIFF_LEVELS } from '../tariffs/tariffsData';

export const SITE_ORIGIN = 'https://openqareer.com';
export const SUPPORT_EMAIL = 'support@openqareer.com';
export const TELEGRAM_BOT_URL = 'https://t.me/openqareer_bot';
export const TELEGRAM_COMMUNITY_URL = 'https://t.me/+i1xBvvPP7w43MWMy';
export const OPERATOR_TAX_ID = '774315089677';
export const ORG_ID = `${SITE_ORIGIN}/#org`;
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

export const LANDING_TITLE_SEO = 'Помощь в поиске работы с ИИ для специалистов | openqareer';
export const LANDING_DESCRIPTION =
  'Помощь в поиске работы для специалистов и руководителей: ИИ проверит резюме на ATS, подберёт вакансии по резюме, в том числе удалённые. Старт бесплатно.';

export interface PipelineStep {
  readonly title: string;
  readonly text: string;
  readonly who: string;
  readonly done: boolean;
}

export const PIPELINE: readonly PipelineStep[] = [
  {
    title: 'Профиль и ATS',
    text: 'Профиль из резюме и проверка, пройдёт ли оно ATS: систему автоотбора резюме у работодателей.',
    who: 'Вы: подтверждаете факты',
    done: true,
  },
  {
    title: 'Роли',
    text: 'Какие роли подтверждает опыт и чего не хватает.',
    who: 'Вы: выбираете роль',
    done: true,
  },
  {
    title: 'Рынок',
    text: 'Сотни источников, процент совпадения.',
    who: 'openqareer: собирает каждый день',
    done: false,
  },
  {
    title: 'Материалы',
    text: 'Резюме и сопроводительное письмо под вакансию.',
    who: 'Вы: правите до отправки',
    done: false,
  },
  {
    title: 'Отклики',
    text: 'Очередь на одобрение и отправка.',
    who: 'Вы: одобряете',
    done: false,
  },
  {
    title: 'Оффер',
    text: 'Подготовка к собеседованию, торг.',
    who: 'openqareer: готовит',
    done: false,
  },
];

export interface ControlPoint {
  readonly title: string;
  readonly text: string;
}

export const CONTROL_POINTS: readonly ControlPoint[] = [
  { title: 'Каждый отклик одобряете вы', text: 'Отправка только в ваших лимитах.' },
  { title: 'Каждый факт подтверждаете вы', text: 'Резюме и письма только из них.' },
  { title: 'Данные ваши', text: 'Выгрузить или удалить их можно одним действием.' },
];

/** Landing tariff blurbs; names and prices come from tariffsData.ts. */
const TARIFF_BLURB: Record<string, string> = {
  free: 'Процент совпадения по каждой вакансии и проверка резюме на ATS.',
  go: 'Резюме и письма под вакансию, подготовка к собеседованию.',
  pro: 'Всё из Basic, плюс отправка одобренных откликов и торг по офферу.',
  max: 'Всё из Pro, плюс эксперт проверяет резюме перед рассылкой, готовит к интервью и разбирает оффер.',
  exec: 'Поиск командой: вакансии вне открытых источников и представления работодателю через связи.',
};

const TARIFF_TERM: Record<string, string> = {
  free: 'без срока',
  go: 'в месяц',
  pro: 'в месяц',
  max: 'в месяц',
  exec: 'разово, по заявке',
};

const TARIFF_ACTION: Record<string, { label: string; href: string }> = {
  free: { label: 'Начать', href: '/signup' },
  go: { label: 'Выбрать Basic', href: '/signup?plan=basic' },
  pro: { label: 'Выбрать Pro', href: '/signup?plan=pro' },
  max: { label: 'Выбрать Max', href: '/signup?plan=max' },
  exec: { label: 'Оставить заявку', href: '/signup?plan=executive' },
};

export interface LandingTariff {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly price: string;
  readonly term: string;
  readonly blurb: string;
  readonly action: { label: string; href: string };
  readonly recommended: boolean;
}

export const LANDING_TARIFFS: readonly LandingTariff[] = TARIFF_LEVELS.map((level) => ({
  id: level.id,
  name: level.name,
  sub: level.sub,
  price: level.price,
  term: TARIFF_TERM[level.id] ?? level.term,
  blurb: TARIFF_BLURB[level.id] ?? level.promise,
  action: TARIFF_ACTION[level.id] ?? { label: 'Выбрать', href: '/signup' },
  recommended: level.id === 'pro',
}));

export interface FaqItem {
  readonly id: string;
  readonly question: string;
  /** Plain text; `links` turn named fragments into anchors on the page. */
  readonly answer: string;
  readonly links?: readonly { readonly text: string; readonly href: string }[];
}

export interface FaqGroup {
  readonly id: string;
  readonly title: string;
  readonly items: readonly FaqItem[];
}

export const FAQ_GROUPS: readonly FaqGroup[] = [
  {
    id: 'start',
    title: 'Начало',
    items: [
      {
        id: 'find-job',
        question: 'Как найти работу быстрее с openqareer?',
        answer:
          'Загрузите резюме: ИИ соберёт профиль, проверит его на ATS и покажет вакансии с процентом совпадения. Дальше каждый день на экране «Сегодня» одно следующее действие с причиной, а отклики, письма и подготовка к собеседованию собраны в одном месте.',
      },
      {
        id: 'after-upload',
        question: 'Что я увижу после загрузки резюме?',
        answer:
          'Профиль по фактам с пометками «подтверждено» и «не проверено», роли, которые подтверждает ваш опыт, вакансии по ним с процентом совпадения и одно следующее действие.',
      },
    ],
  },
  {
    id: 'resume',
    title: 'Резюме и ATS',
    items: [
      {
        id: 'ats',
        question: 'Что такое ATS и как проверить резюме на ATS?',
        answer:
          'ATS (система автоотбора резюме у работодателей) отсеивает резюме до того, как их увидит человек. В профиле openqareer есть карточка «Прохождение ATS»: оценка из 100 по структуре, ключевым словам, датам и формату с подсказками, что исправить.',
      },
      {
        id: 'ai-resume',
        question: 'Как ИИ составляет резюме и сопроводительное письмо?',
        answer:
          'Только из подтверждённых фактов профиля и требований конкретной вакансии. Вы видите текст до отправки и правите его. Письма и резюме под вакансию готовятся на платных тарифах.',
      },
      {
        id: 'cover-letter',
        question: 'Как написать сопроводительное письмо к резюме и вакансии?',
        answer:
          'Откройте вакансию в кабинете: ИИ соберёт письмо из подтверждённых фактов профиля под требования этой вакансии, а вы поправите текст до отправки. Доступно на платных тарифах.',
      },
      {
        id: 'facts',
        question: 'Откуда берутся факты профиля и можно ли их исправить?',
        answer:
          'Из загруженного резюме, профилей на площадках и ваших ответов консультанту. У каждого факта виден источник; любой пункт можно подтвердить, исправить или удалить.',
      },
    ],
  },
  {
    id: 'jobs',
    title: 'Вакансии',
    items: [
      {
        id: 'sources',
        question: 'Откуда вакансии?',
        answer:
          'Из сотен источников: hh.ru, LinkedIn, Indeed, карьерные сайты компаний и другие. Пул обновляется автоматически, у каждой вакансии есть прямая ссылка на источник. Часть пула открыта в каталоге вакансий.',
        links: [{ text: 'каталоге вакансий', href: '/vacancies' }],
      },
      {
        id: 'match',
        question: 'Как считается процент совпадения?',
        answer:
          'Требования берутся из текста вакансии и сверяются с подтверждёнными фактами профиля. В кабинете у каждого процента виден список совпавших и недостающих требований. Нет данных, нет процента.',
      },
      {
        id: 'remote',
        question: 'Как найти удалённую работу?',
        answer:
          'Выберите формат «удалённо» в кабинете: в пуле больше ста тысяч удалённых вакансий, в том числе за рубежом, с процентом совпадения по каждой. Без регистрации их можно посмотреть в каталоге удалённых вакансий.',
        links: [{ text: 'каталоге удалённых вакансий', href: '/vacancies/remote' }],
      },
    ],
  },
  {
    id: 'apply',
    title: 'Отклики',
    items: [
      {
        id: 'auto-apply',
        question: 'Отправляет ли openqareer отклики за меня?',
        answer: 'На Pro и выше, и только одобренные вами. На Free и Basic отправляете вы сами.',
      },
      {
        id: 'limits',
        question: 'Можно ли ограничить отправку?',
        answer:
          'Да. Вы задаёте лимит откликов в день, окна тишины и паузы. Каждая отправка попадает в журнал, ответы приходят в Telegram.',
      },
      {
        id: 'employer',
        question: 'Узнает ли текущий работодатель, что я ищу работу?',
        answer:
          'Из openqareer не узнает: профиль видите только вы, а отклики уходят только туда, куда вы их одобрили. Резюме на площадках живут по правилам этих площадок.',
      },
      {
        id: 'consultant',
        question: 'Чем поможет карьерный консультант?',
        answer:
          'Консультант в кабинете помнит ваш профиль и прошлые разговоры: поможет выбрать роль, разобрать вакансию, подготовиться к собеседованию и обсудить оффер. Пишите текстом или голосом. На Free доступен в ограниченном объёме.',
      },
    ],
  },
  {
    id: 'plans',
    title: 'Тарифы и оплата',
    items: [
      {
        id: 'price',
        question: 'Сколько это стоит?',
        answer:
          'Free бесплатный и без срока: профиль, роли, вакансии, проверка резюме на ATS и отклики вручную. Basic 3 990 ₽, Pro 9 900 ₽, Max 39 900 ₽ в месяц, отмена в один клик. Executive от 150 до 300 тыс. ₽ разово, по заявке.',
      },
      {
        id: 'plans-diff',
        question: 'Чем отличаются тарифы?',
        answer:
          'Free: профиль, роли и вакансии. Basic: резюме и письма под вакансию, подготовка к собеседованию. Pro: всё из Basic и отправка одобренных откликов. Max: всё из Pro и эксперт на резюме, интервью и оффере. Executive: поиск командой по заявке.',
      },
      {
        id: 'cancel',
        question: 'Как отменить подписку?',
        answer: 'В кабинете, раздел «Тарифы», в один клик.',
      },
    ],
  },
  {
    id: 'data',
    title: 'Данные и приложение',
    items: [
      {
        id: 'resume-data',
        question: 'Что происходит с моим резюме после загрузки?',
        answer:
          'Оно хранится в зашифрованном виде, пока активен аккаунт. Для разбора текст передаётся сервисам обработки текста; работодателю резюме уходит только в отклике, который вы одобрили.',
      },
      {
        id: 'delete-data',
        question: 'Можно ли выгрузить или удалить данные?',
        answer:
          'Да. В аккаунте есть выгрузка всех данных одним файлом и удаление аккаунта вместе с данными.',
      },
      {
        id: 'desktop',
        question: 'Зачем приложение для компьютера?',
        answer:
          'В нём подключаются профили на hh.ru, LinkedIn и других площадках; пароли площадок openqareer не получает.',
      },
      {
        id: 'mac-install',
        question: 'Как установить приложение на Mac?',
        answer:
          'Скачайте файл на главной и перетащите приложение в «Программы». Сборка для Intel, на Apple Silicon запускается через Rosetta. Подписи Apple пока нет, поэтому первый запуск: правый клик по приложению, затем «Открыть».',
        links: [{ text: 'на главной', href: '/#download' }],
      },
      {
        id: 'windows',
        question: 'Есть ли версия для Windows?',
        answer:
          'Версия для Windows в разработке. Пока пользуйтесь сайтом в браузере: кабинет тот же.',
      },
    ],
  },
];

/** Six questions shown on the landing; the full set lives on /faq. */
export const LANDING_FAQ_IDS = [
  'find-job',
  'ai-resume',
  'auto-apply',
  'remote',
  'resume-data',
  'employer',
] as const;

export function faqItemById(id: string): FaqItem {
  for (const group of FAQ_GROUPS) {
    const item = group.items.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  throw new Error(`faq item ${id} is not defined`);
}
