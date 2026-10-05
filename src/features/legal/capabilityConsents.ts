/**
 * Юридические согласия кандидата на возможности профиля (B263).
 *
 * Согласие требуется только на действия, непосредственно касающиеся
 * самого кандидата:
 * - profile_activity: фоновая активность в подключённом профиле
 * - digital_footprint: аудит открытого профессионального следа
 * - actions_on_behalf: действия от имени кандидата (отклики и поднятие резюме)
 *
 * Флаг CAPABILITY_CONSENTS_APPROVED выключен до явного утверждения текстов владельцем.
 */

export const CAPABILITY_CONSENTS_APPROVED = false;

export const CANDIDATE_CAPABILITIES = [
  'profile_activity',
  'digital_footprint',
  'actions_on_behalf',
] as const;

export type CandidateCapability = (typeof CANDIDATE_CAPABILITIES)[number];

export function isCandidateCapability(value: string): value is CandidateCapability {
  return (CANDIDATE_CAPABILITIES as readonly string[]).includes(value);
}

export const CAPABILITY_CONSENT_CURRENT_VERSION: Record<CandidateCapability, string> = {
  profile_activity: 'profile_activity-v1.0',
  digital_footprint: 'digital_footprint-v1.1',
  actions_on_behalf: 'actions_on_behalf-v1.0',
};

export interface CapabilityConsentDocument {
  readonly capability: CandidateCapability;
  readonly versionId: string;
  readonly title: string;
  readonly items: readonly string[];
}

export const CAPABILITY_CONSENT_DOCUMENTS: Record<CandidateCapability, CapabilityConsentDocument> = {
  profile_activity: {
    capability: 'profile_activity',
    versionId: 'profile_activity-v1.0',
    title: 'Фоновая активность в подключённом профиле',
    items: [
      'Платформа периодически проверяет актуальность данных вашего профиля в подключённой профессиональной сети по согласованному рабочему графику.',
      'Платформа не публикует записи, не отправляет сообщения и не направляет заявки в контакты от вашего имени без вашего прямого подтверждения.',
      'Учётные данные и сессионные параметры хранятся в зашифрованном виде и никогда не передаются третьим лицам.',
      'Вы можете в любой момент отозвать это согласие в настройках профиля, что немедленно остановит любую фоновую активность.',
    ],
  },
  digital_footprint: {
    capability: 'digital_footprint',
    versionId: 'digital_footprint-v1.1',
    title: 'Аудит открытого профессионального следа',
    items: [
      'Перед запуском вы видите план запросов и можете снять отметки с никнеймов, ссылок, имени, компаний и города.',
      'Для поиска Exa получает только выбранные имя, компании и город. HIBP получает 6-символьный SHA-1-префикс почты по k-анонимности; полный адрес и пароль не передаются. Утверждённый тариф HIBP должен поддерживать поиск по диапазону хэша.',
      'Ссылка на фото из профиля не передаётся поисковику: она сравнивается локально с URL изображения из ответа Exa. Обратный поиск по изображению не выполняется.',
      'Wayback CDX получает выбранные публичные ссылки. По выбранным сайтам проверяется только открытый профиль запросом GET, без входа, регистрации и действий от вашего имени. Пароли, cookies, токены, телефон и паспортные данные не запрашиваются; личная переписка и закрытые данные не читаются.',
      'Результаты доступны только вам и не передаются работодателям без отдельного согласия. Вы можете отозвать согласие: текущая проверка остановится, а её сохранённые находки удалятся.',
    ],
  },
  actions_on_behalf: {
    capability: 'actions_on_behalf',
    versionId: 'actions_on_behalf-v1.0',
    title: 'Действия от имени кандидата',
    items: [
      'Платформа помогает направлять согласованные отклики на выбранные вами вакансии и обновлять дату актуальности резюме на карьерных площадках.',
      'Ни один отклик не направляется работодателю автоматически без вашего предварительного выбора вакансии и одобрения текста.',
      'Платформа действует строго в рамках предоставленных полномочий и фиксирует каждое совершённое действие в журнале событий.',
      'Вы можете в любой момент отозвать согласие, что немедленно прекратит любые действия платформы от вашего имени.',
    ],
  },
};
