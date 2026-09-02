/**
 * Тип поста канала: вакансия, резюме кандидата, промо, дайджест или неизвестно.
 *
 * Замер среза 3 B164: из 96 записей 38 не несли ни одного сигнала найма —
 * курсы («Claude Code для продактов»), новости и объявления кандидатов о себе
 * («Меня зовут София, я концепт художник»). Прямой фильтр «нет глагола найма →
 * не вакансия» отрезал бы вместе с ними настоящие вакансии из той же выборки,
 * поэтому вакансию узнаёт не глагол, а **структура объявления**: разделы
 * обязанностей, требований, условий, стека, зарплаты и контакта для отклика.
 *
 * Неизвестный тип вакансией не считается: показать пост, о котором продукт
 * ничего не понял, как вакансию — это тот же запрет B161, что и выдуманный
 * работодатель.
 */
export type TelegramPostType = 'vacancy' | 'resume' | 'promo' | 'digest' | 'unknown';

const HIRING_VERBS = [
  /#вакансия/iu,
  // «Ищем» от первого лица множественного — это работодатель; кандидат о себе
  // пишет «ищу». Границу слова здесь нельзя писать через `\b`: в JavaScript
  // это ASCII-граница, и перед кириллицей она не срабатывает вовсе.
  /(?:^|[^а-яё])ищем(?:[^а-яё]|$)/iu,
  /(?:^|[^а-яё])ищется(?:[^а-яё]|$)/iu,
  /#job\b/i,
  /мы ищем/iu,
  /ищем в команду/iu,
  /в поисках/iu,
  /открыта позиция/iu,
  /открыта вакансия/iu,
  /требуется/iu,
  /нанимаем/iu,
  /предлагаем работу/iu,
  /we are hiring/i,
  /we're hiring/i,
  /is hiring/i,
  /join our team/i,
];

/** Разделы, из которых состоит объявление о работе. */
const VACANCY_SECTIONS = [
  /обязанност/iu,
  /компания:/iu,
  /формат( работы)?:/iu,
  /занятость:/iu,
  /локация:/iu,
  /график:/iu,
  /уровень:/iu,
  /требовани/iu,
  /услови[яй]/iu,
  /задачи:/iu,
  /что предстоит делать/iu,
  /чем предстоит заниматься/iu,
  /мы предлагаем/iu,
  /что мы предлагаем/iu,
  /наш стек/iu,
  /стек:/iu,
  /о компании:/iu,
  /responsibilit/i,
  /requirements/i,
  /what you.ll do/i,
  /we offer/i,
];

const SALARY = /(?:зарплат|оплата|доход|salary|compensation|от\s*\d[\d\s]{3,}|\d[\d\s]{3,}\s*(?:₽|руб|\$|€))/iu;
const APPLY_CONTACT = /(?:отклик|контакты|резюме присылайте|писать|apply|contact)[^\n]{0,40}(?:@[a-z0-9_]{4,}|https?:\/\/|[\w.+-]+@[\w-]+\.\w+)/iu;

const RESUME_SIGNALS = [
  /меня зовут/iu,
  /ищу работу/iu,
  /ищу проект/iu,
  /рассматриваю предложени/iu,
  /открыт[аы]? к предложени/iu,
  /мо[ёе] портфолио/iu,
  /#резюме/iu,
  /#ищуработу/iu,
];

const PROMO_SIGNALS = [
  /#реклама/iu,
  /#партнерский/iu,
  /записывайтесь/iu,
  /вебинар/iu,
  /мастер-класс/iu,
  /интенсив/iu,
  /курс[ае]?\b/iu,
  /регистрация по ссылке/iu,
  /промокод/iu,
  /скидка \d+%/iu,
];

const DIGEST_SIGNALS = [
  /#дайджест/iu,
  /дайджест/iu,
  /подборк[аи]/iu,
  /топ-?\d+/iu,
  /новости рынка/iu,
  /читайте/iu,
];

export function classifyTelegramPost(text: string): TelegramPostType {
  const clean = text.toLowerCase();
  const structure = VACANCY_SECTIONS.filter((rx) => rx.test(clean)).length;
  const hiring = HIRING_VERBS.some((rx) => rx.test(clean));
  // Объявление о работе узнаётся по структуре: два раздела подряд — это уже
  // вакансия, даже если глагола найма в тексте нет.
  const looksLikeVacancy =
    hiring || structure >= 2 || (structure >= 1 && SALARY.test(clean) && APPLY_CONTACT.test(clean));

  if (RESUME_SIGNALS.some((rx) => rx.test(clean)) && !hiring) return 'resume';
  if (PROMO_SIGNALS.some((rx) => rx.test(clean)) && !looksLikeVacancy) return 'promo';
  if (DIGEST_SIGNALS.some((rx) => rx.test(clean)) && !looksLikeVacancy) return 'digest';
  if (looksLikeVacancy) return 'vacancy';
  return 'unknown';
}
