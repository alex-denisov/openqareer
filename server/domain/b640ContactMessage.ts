import {
  B640_CONTACT_MESSAGE_DRAFT_MAX,
  type B640ContactMessageKind,
} from '../../shared/b640ContactMessage';

/**
 * B698: сборка короткого сообщения знакомому или рекрутёру. Здесь только запрос к модели и шаблон
 * запасного текста; карточка B613 заменяет `contactMessageWish` и `fallbackContactMessage`.
 */
export interface ContactMessageFacts {
  readonly kind: B640ContactMessageKind;
  readonly recipientName: string;
  /** Компания получателя (знакомого или рекрутёра). */
  readonly recipientCompany: string;
  /** Целевая роль кандидата из профиля; пусто — не называем. */
  readonly targetRole: string;
  readonly vacancyTitle?: string;
  readonly vacancyCompany?: string;
  /** Вторая вакансия той же компании (карточка компании, B698): только для текста. */
  readonly alsoVacancyTitle?: string;
  /** Должность получателя из контакта («Head of Data»). */
  readonly recipientRole?: string;
  /** Как кандидат связан со знакомым («Коллега»); только для знакомого. */
  readonly relationship?: string;
}

const KIND_TASK: Readonly<Record<B640ContactMessageKind, string>> = {
  known_contact: 'знакомому: напомни о себе и спроси, не подскажет ли он, куда обратиться с поиском работы',
  ask_introduction: 'знакомому: попроси представить кандидата человеку в нужной компании',
  recruiter: 'рекрутёру: коротко представься и скажи, чем интересна вакансия',
};

/**
 * Знакомому из карточки компании или вакансии: сообщение про эту компанию — вакансия, просьба
 * порекомендовать или представить. Общий вопрос «куда обратиться» — только без вакансии.
 */
const COMPANY_TASK: Readonly<Record<Exclude<B640ContactMessageKind, 'recruiter'>, (company: string) => string>> = {
  known_contact: (company) =>
    `знакомому, который связан с компанией ${company}: напомни о себе, скажи, что тебя интересует вакансия ${company}, и спроси, не порекомендует ли он тебя или не расскажет ли о команде и о том, кто нанимает на эту роль`,
  ask_introduction: (company) =>
    `знакомому: попроси представить кандидата тому, кто нанимает на вакансию в компании ${company}`,
};

function taskOf(facts: ContactMessageFacts): string {
  const company = facts.vacancyCompany || facts.recipientCompany;
  if (facts.kind === 'recruiter' || !facts.vacancyTitle || !company) return KIND_TASK[facts.kind];
  return COMPANY_TASK[facts.kind](company);
}

const quoted = (titles: ReadonlyArray<string | undefined>) =>
  titles.filter((title): title is string => Boolean(title)).map((title) => `«${title}»`).join(' и ');

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] ?? '';
}

/**
 * B753 (прод 23.11): знакомому модель писала «Откликаюсь на вакансию VK…» — письмо работодателю.
 * Сообщение знакомому — человеку, которого кандидат знает; у рекрутёра свой тон.
 */
const ACQUAINTANCE_RULES = [
  'Это сообщение знакомому, а не отклик работодателю: не пиши «Откликаюсь», «Прошу рассмотреть», «Рассмотрите мою кандидатуру», «Направляю резюме» и похожие слова отклика.',
  'Порядок: короткое приветствие по имени; зачем пишешь; конкретная просьба — порекомендовать тебя или рассказать о команде; один факт из профиля, связанный с вакансией.',
];

/** Слова отклика работодателю: в сообщении знакомому такой текст не принимается (B753). */
const RESPONSE_FORMULA = /(откликаюсь|хочу откликнуться|прошу рассмотреть|рассмотрите[\s,]+(пожалуйста[\s,]+)?мою кандидатуру|направляю (вам )?(своё |свое |моё |мое )?резюме)/iu;

/** Просьба к модели вместо письма работодателю: короткое личное сообщение, без темы и подписи. */
export function contactMessageWish(facts: ContactMessageFacts): string {
  const lines = [
    `ВАЖНО: это не письмо работодателю, а личное сообщение в LinkedIn ${taskOf(facts)}.`,
    `Получатель: ${facts.recipientName}${facts.recipientRole ? `, ${facts.recipientRole}` : ''}${facts.recipientCompany ? `, ${facts.recipientCompany}` : ''}.`,
    facts.relationship ? `Как знакомы: ${facts.relationship}.` : '',
    facts.vacancyTitle
      ? `${facts.alsoVacancyTitle ? 'Вакансии' : 'Вакансия'}: ${quoted([facts.vacancyTitle, facts.alsoVacancyTitle])}${facts.vacancyCompany ? `, ${facts.vacancyCompany}` : ''}.`
      : '',
    facts.vacancyTitle && facts.kind !== 'recruiter'
      ? 'Назови компанию и вакансию; общий вопрос о поиске работы без компании не подходит.'
      : '',
    // B753 (прод 23.11): при «500 знаков» GLM писал 610–760 и уходил в шаблон.
    `3–4 коротких предложения. Не длиннее ${B640_CONTACT_MESSAGE_DRAFT_MAX - 200} знаков, без темы, без подписи, без приветствия «Уважаемый».`,
    'Пиши только то, что есть в профиле кандидата; не добавляй цифр, достижений и обещаний, которых там нет.',
    ...(facts.kind === 'recruiter' ? [] : ACQUAINTANCE_RULES),
  ];
  return lines.filter(Boolean).join('\n');
}

/** Запасной текст по подтверждённым данным: имя, целевая роль, компания, вакансия. */
export function fallbackContactMessage(facts: ContactMessageFacts): string {
  const name = firstName(facts.recipientName);
  const role = facts.targetRole.trim() ? ` на роль «${facts.targetRole.trim()}»` : '';
  const company = facts.vacancyCompany || facts.recipientCompany;
  const greeting = name ? `${name}, здравствуйте!` : 'Здравствуйте!';
  if (facts.kind === 'recruiter') {
    const title = facts.vacancyTitle ? `вакансия «${facts.vacancyTitle}»${company ? ` в компании «${company}»` : ''}` : 'ваша вакансия';
    return `${greeting} Меня заинтересовала ${title}. Могу коротко рассказать о своём опыте и ответить на вопросы. Удобно ли вам обсудить?`;
  }
  const vacancies = quoted([facts.vacancyTitle, facts.alsoVacancyTitle]);
  if (facts.kind === 'ask_introduction') {
    const where = company ? ` в компании «${company}»` : '';
    const onto = vacancies ? ` на ${facts.alsoVacancyTitle ? 'вакансии' : 'вакансию'} ${vacancies}` : '';
    return `${greeting} Я сейчас в поиске${role}. Не могли бы вы представить меня тому, кто занимается наймом${onto}${where}? Материалы для знакомства пришлю, заранее спасибо!`;
  }
  if (vacancies && company) {
    const open = facts.alsoVacancyTitle ? 'открыты вакансии' : 'открыта вакансия';
    return `${greeting} Давно не общались. Вижу, что в «${company}» ${open} ${vacancies}. Я сейчас в поиске${role}. Не порекомендуете меня или не подскажете, кто нанимает на ${facts.alsoVacancyTitle ? 'эти роли' : 'эту роль'}? Заранее спасибо!`;
  }
  return `${greeting} Давно не общались. Я сейчас в поиске${role}. Если знаете, где ищут такого специалиста, или подскажете, к кому обратиться, — заранее спасибо!`;
}

function digitGroups(text: string): string[] {
  return text.match(/\d+/gu) ?? [];
}

export type ModelMessageRejection = 'empty' | 'too_long' | 'new_digits' | 'response_formula';

/** B753: почему текст модели не принят — в журнал вместо молчаливого запасного текста. */
export function modelMessageRejection(
  text: string | undefined,
  knownText: string,
  kind: B640ContactMessageKind = 'recruiter',
): ModelMessageRejection | null {
  const body = text?.trim().replace(/\r\n?/gu, '\n');
  if (!body) return 'empty';
  if (body.length > B640_CONTACT_MESSAGE_DRAFT_MAX) return 'too_long';
  if (kind !== 'recruiter' && RESPONSE_FORMULA.test(body)) return 'response_formula';
  return digitGroups(body).every((group) => knownText.includes(group)) ? null : 'new_digits';
}

/**
 * Текст модели принимаем, только если он непустой, в пределе длины и не вводит чисел, которых нет
 * в профиле или данных запроса; иначе вызывающий берёт запасной текст.
 */
export function acceptModelMessage(
  text: string | undefined,
  knownText: string,
  kind: B640ContactMessageKind = 'recruiter',
): string | null {
  if (modelMessageRejection(text, knownText, kind)) return null;
  return text!.trim().replace(/\r\n?/gu, '\n');
}

/** Только https и сам linkedin.com, без логина в адресе; всё остальное — null. */
export function linkedinOpenUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted = host === 'linkedin.com' || host === 'www.linkedin.com';
    return url.protocol === 'https:' && trusted && !url.username && !url.password && !url.port ? url.toString() : null;
  } catch {
    return null;
  }
}
