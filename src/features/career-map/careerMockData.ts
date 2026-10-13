import type { CareerRoleModel, SearchConditionsDraft } from './careerScreenTypes';

export const DEFAULT_MOCK_ROLES: readonly CareerRoleModel[] = [
  {
    id: 'dir',
    title: 'Director of Engineering',
    status: 'skills_checked',
    wageDisplay: '600–780 тыс. ₽',
    isWageCalculated: true,
    vacancyCount: 88,
    observedDate: '05.10',
    sampleNote: '88 вакансий',
    confirmedItems: ['Платёжные системы: квиз пройден 03.10'],
    missingItems: [
      {
        text: 'Бюджет разработки не указан: без него уровень не считается',
        isWarning: true,
        linkSection: 'Профиль, Опыт',
        linkText: 'указать бюджет разработки',
      },
      {
        text: 'Kafka и Kubernetes: нужен тест, около 15 минут',
        isQuestion: true,
      },
    ],
    nextAction: {
      label: 'Дозаполнить',
      action: 'fill_with_consultant',
      href: '#',
    },
    hypothesisReason: 'Вывод из профиля, подтверждённый квизом.',
  },
  {
    id: 'head',
    title: 'Head of Engineering',
    status: 'open_for_search',
    wageDisplay: '420–560 тыс. ₽',
    isWageCalculated: true,
    vacancyCount: 312,
    observedDate: '05.10',
    sampleNote: 'по 94 вакансиям, 05.10',
    confirmedItems: ['Квиз по управлению командами пройден 01.10'],
    missingItems: [],
    nextAction: {
      label: 'Открыть вакансии',
      action: 'open_vacancies',
      href: '4-vakansii.html',
    },
  },
  {
    id: 'cto',
    title: 'CTO в финтехе',
    status: 'hypothesis',
    wageDisplay: '650–900 тыс. ₽',
    isWageCalculated: true,
    vacancyCount: 41,
    observedDate: '05.10',
    sampleNote: '41 вакансия',
    confirmedItems: ['Платёжные системы: квиз пройден 03.10'],
    missingItems: [
      {
        text: 'Опыт совета директоров: в профиле не указан',
        linkSection: 'Профиль, Опыт',
      },
      {
        text: 'Регуляторика (ЦБ, PCI DSS): в профиле не указана',
        linkSection: 'Профиль, Навыки',
      },
    ],
    skillCheckBenefit:
      'Диалог с консультантом и 3 тест-кейса, около 20 минут. После неё роль откроется для поиска.',
    nextAction: {
      label: 'Проверить навыки',
      action: 'check_skills',
      href: '11-proverka-navykov.html',
    },
    hypothesisReason:
      'Гипотеза консультанта: платёжные системы в вашем опыте совпадают с типичными требованиями к CTO в финтехе. Это вывод из профиля, пока не проверенный.',
  },
  {
    id: 'vp',
    title: 'VP Engineering',
    status: 'hypothesis',
    wageDisplay: 'вилка не считается',
    isWageCalculated: false,
    vacancyCount: 4,
    observedDate: '05.10',
    sampleNote: '4 вакансии',
    confirmedItems: [],
    missingItems: [],
    nextAction: {
      label: 'Мало данных',
      action: 'few_data',
      href: '#',
    },
  },
];

export const DEFAULT_SEARCH_CONDITIONS: SearchConditionsDraft = {
  geography: {
    selected: ['Москва', 'Удалённо из РФ'],
    isRelocationEnabled: false,
  },
  salaryFrom: {
    amountRubles: 450000,
    showWithoutSalary: true,
  },
  format: {
    office: false,
    hybrid: true,
    remote: true,
  },
  stopList: [
    { id: 'greencode', name: 'Гринкод', origin: 'добавлено вручную' },
    { id: 'sever', name: 'Банк Север', origin: 'из отказа 03.10' },
  ],
  matchingStats: {
    matched: 148,
    total: 214,
    asOf: '07.10 09:12',
  },
};
