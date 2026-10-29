import type { AccountConsent, AccountNotificationEvent } from './accountTypes';

export const DEFAULT_NOTIFICATION_EVENTS: readonly AccountNotificationEvent[] = [
  {
    id: 'ev-reply',
    index: 0,
    title: 'Ответ работодателя',
    iconName: 'EnvelopeSimple',
    timing: 'Приходит сразу, когда работодатель ответил на отклик или написал вам.',
    reason:
      'Срочное и важное: приложение и почта сразу, Telegram после подключения.',
    app: true,
    telegram: true,
    email: true,
  },
  {
    id: 'ev-reminder',
    index: 1,
    title: 'Напоминание о сроках и интервью',
    iconName: 'Clock',
    timing:
      'За день и за час до интервью, дедлайна тестового, шага из «Хочу в компанию».',
    reason:
      'Срочное по времени: приложение сразу, Telegram после подключения; почта опаздывает.',
    app: true,
    telegram: true,
    email: false,
  },
  {
    id: 'ev-approval',
    index: 2,
    title: 'Очередь ждёт вашего одобрения',
    iconName: 'ListChecks',
    timing: 'Когда в очереди появились отклики, ожидающие вашего «Отправить».',
    reason: 'Не срочное: хватает приложения, лишнего шума в других каналах нет.',
    app: true,
    telegram: false,
    email: false,
  },
  {
    id: 'ev-delivery-error',
    index: 3,
    title: 'Ошибка доставки отклика',
    iconName: 'WarningCircle',
    timing: 'Когда площадка отклонила отклик или он не ушёл.',
    reason:
      'Важное: от него зависит результат, поэтому приложение, почта и Telegram после подключения.',
    app: true,
    telegram: true,
    email: true,
  },
  {
    id: 'ev-target-company',
    index: 4,
    title: 'Новая вакансия в компании из «Хочу в компанию»',
    iconName: 'Briefcase',
    timing: 'Когда в целевой компании появилась вакансия по вашим ролям.',
    reason: 'Информационное: приложение, без почты и Telegram.',
    app: true,
    telegram: false,
    email: false,
  },
  {
    id: 'ev-weekly-digest',
    index: 5,
    title: 'Итоги недели и разбор в карьерном дневнике',
    iconName: 'Notebook',
    timing: 'Раз в неделю, когда готова заготовка разбора и итоги целей.',
    reason: 'Информационное: приложение и почта, Telegram не нужен.',
    app: true,
    telegram: false,
    email: true,
  },
];

export const MANDATORY_NOTIFICATION_EVENTS: readonly AccountNotificationEvent[] = [
  {
    id: 'mand-payments',
    index: 6,
    title: 'Платежи: письмо за 2 дня до списания, чек',
    iconName: 'Wallet',
    timing: 'Письмо за 2 дня до списания и чек после успешной оплаты.',
    reason: 'Обязательное уведомление по закону и правилам сервиса.',
    app: true,
    telegram: false,
    email: true,
    mandatory: true,
    mandatoryNote: 'обязательное, отключить нельзя',
  },
  {
    id: 'mand-security',
    index: 7,
    title: 'Безопасность: новый вход, смена пароля',
    iconName: 'ShieldCheck',
    timing: 'При каждом новом входе с неизвестного устройства или смене пароля.',
    reason: 'Обязательное уведомление для защиты аккаунта.',
    app: true,
    telegram: false,
    email: true,
    mandatory: true,
    mandatoryNote: 'обязательное, отключить нельзя',
  },
];

export const DEFAULT_ACCOUNT_CONSENTS: readonly AccountConsent[] = [
  {
    id: 'cons-auto-applies',
    index: 0,
    title: 'Автоотклики',
    description: 'Черновики и отправка на hh.ru и в LinkedIn после вашего одобрения',
    date: '',
    consequences:
      'Очередь остановится, неотправленные черновики останутся в списке без отправки. Уже отправленные отклики и журнал не удаляются.',
  },
  {
    id: 'cons-footprint',
    index: 1,
    title: 'Цифровой след',
    description:
      'Поиск ваших публичных упоминаний; находки видите только вы, до подтверждения не попадают в профиль',
    date: '',
    consequences: 'Поиск упоминаний остановится, найденное останется у вас.',
  },
  {
    id: 'cons-profile-data',
    index: 2,
    title: 'Обработка данных профиля',
    description: 'Хранение и разбор резюме, истории откликов, контактов',
    date: '',
    consequences: 'Без неё профиль и подборка работать не смогут.',
  },
  {
    id: 'cons-mobility',
    index: 3,
    title: 'Данные о мобильности',
    description:
      'Гражданство, документы, диплом, семья и сроки для раздела «Страны и релокация»; видите только вы, отзыв удаляет данные и выключает релокацию',
    date: '',
    consequences: 'Данные о мобильности будут удалены, релокация отключится.',
  },
  {
    id: 'cons-linkedin-contacts',
    index: 4,
    title: 'Контакты LinkedIn',
    description:
      'Ваши контакты — пути в компании для других кандидатов; они видят только число путей',
    date: '',
    consequences: 'Ваши связи будут удалены из общего указателя путей.',
  },
  {
    id: 'cons-linkedin-feed',
    index: 5,
    title: 'Анализ ленты LinkedIn',
    description:
      'Темы постов по вашей ленте; без согласия темы берутся из профиля и ролей',
    date: '',
    consequences: 'Темы постов будут браться из профиля и ролей.',
  },
];
