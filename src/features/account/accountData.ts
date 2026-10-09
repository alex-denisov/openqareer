import type {
  AccountAppSettings,
  AccountConnection,
  AccountConsent,
  AccountDevice,
  AccountNotificationEvent,
  AccountPaymentItem,
} from './accountTypes';

export const DEFAULT_ACCOUNT_DEVICES: readonly AccountDevice[] = [
  {
    id: 'dev-desktop',
    kind: 'desktop',
    name: 'Приложение openqareer, этот Mac',
    details: 'Версия 1.0.0 · последняя активность сейчас · вход 28.09',
    current: true,
  },
  {
    id: 'dev-chrome',
    kind: 'globe',
    name: 'Браузер, Chrome на macOS',
    details: 'Последняя активность 07.10 09:12 · вход 06.10 · сессия продлевается 30 дней',
    current: false,
  },
  {
    id: 'dev-safari',
    kind: 'globe',
    name: 'Браузер, Safari на iPhone',
    details: 'Последняя активность 02.10 21:40 · вход 02.10',
    current: false,
  },
];

export const DEFAULT_ACCOUNT_CONNECTIONS: readonly AccountConnection[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    details: 'Подключено 12.09 · вход сохранён до 10.10 · импортировано 9 из 9 мест работы',
    status: 'ok',
    statusLabel: 'Подключено',
    manageable: true,
  },
  {
    id: 'hh',
    name: 'hh.ru',
    details: 'Подключено 07.10 · импортировано 8 из 9 мест работы',
    status: 'warn',
    statusLabel: 'Частично',
    manageable: true,
  },
  {
    id: 'others',
    name: 'Другие площадки',
    details:
      'Подключите площадку, и отклики пойдут и туда. Список площадок и условия открываются при подключении.',
    status: 'dim',
    statusLabel: 'Не подключено',
  },
  {
    id: 'email',
    name: 'Почта',
    details:
      'Нужна, чтобы видеть ответы работодателей. Не подключена: ответы вносите вручную.',
    status: 'dim',
    statusLabel: 'Не подключено',
  },
  {
    id: 'calendar',
    name: 'Календарь',
    details: 'Нужен, чтобы ставить интервью и напоминания. Не подключён.',
    status: 'dim',
    statusLabel: 'Не подключено',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    details:
      'Бот @openqareer_bot: напоминания о сроках. Не подключён: напоминания придут в приложение.',
    status: 'dim',
    statusLabel: 'Не подключено',
  },
];

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
    date: '03.10',
    consequences:
      'Очередь остановится, неотправленные черновики останутся в списке без отправки. Уже отправленные отклики и журнал не удаляются.',
  },
  {
    id: 'cons-footprint',
    index: 1,
    title: 'Цифровой след',
    description:
      'Поиск ваших публичных упоминаний; находки видите только вы, до подтверждения не попадают в профиль',
    date: '05.10',
    consequences: 'Поиск упоминаний остановится, найденное останется у вас.',
  },
  {
    id: 'cons-profile-data',
    index: 2,
    title: 'Обработка данных профиля',
    description: 'Хранение и разбор резюме, истории откликов, контактов',
    date: '12.09',
    consequences: 'Без неё профиль и подборка работать не смогут.',
  },
  {
    id: 'cons-mobility',
    index: 3,
    title: 'Данные о мобильности',
    description:
      'Гражданство, документы, диплом, семья и сроки для раздела «Страны и релокация»; видите только вы, отзыв удаляет данные и выключает релокацию',
    date: '08.10',
    consequences: 'Данные о мобильности будут удалены, релокация отключится.',
  },
  {
    id: 'cons-linkedin-contacts',
    index: 4,
    title: 'Контакты LinkedIn',
    description: 'Использование контактов для маршрутов к компаниям',
    date: '',
    consequences: 'Маршруты к компаниям перестанут использовать контакты.',
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

export const DEFAULT_APP_SETTINGS: AccountAppSettings = {
  version: '1.0.0',
  checkDate: 'сегодня в 09:12',
  autoUpdate: true,
  menuBar: true,
  launchAtLogin: false,
};

export const DEFAULT_PAYMENT_HISTORY: readonly AccountPaymentItem[] = [
  { date: '08.10', title: 'Pro, месяц', amount: '9 900 ₽', method: 'Карта РФ' },
  { date: '08.09', title: 'Pro, месяц', amount: '9 900 ₽', method: 'Карта РФ' },
  { date: '08.08', title: 'Pro, месяц', amount: '9 900 ₽', method: 'СБП' },
  { date: '08.07', title: 'Basic, месяц', amount: '3 990 ₽', method: 'СБП' },
  { date: '08.06', title: 'Basic, месяц', amount: '3 990 ₽', method: 'СБП' },
  { date: '08.05', title: 'Basic, месяц', amount: '3 990 ₽', method: 'Карта РФ' },
];
