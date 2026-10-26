/**
 * Частное лицо вместо работодателя (INC-023).
 *
 * hh.ru пускает размещать вакансии людей: нанимает няню семья, бухгалтера —
 * предприниматель, и в поле работодателя тогда стоит ФИО. Публичный каталог
 * индексируется поисковиками, а чужие персональные данные в нём запрещены,
 * поэтому имя человека заменяется словами «Частный работодатель».
 *
 * Надёжный признак — категория площадки (`employerIsPerson`). Записи,
 * собранные до него, её не несут, и для них остаётся форма имени: ФИО с
 * отчеством, фамилия с инициалами, «ИП …». Название компании с фамилией
 * («Рабинович Групп») формой ФИО не является и остаётся как есть.
 */
export const PRIVATE_EMPLOYER = 'Частный работодатель';

const NAME_PART = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?$/u;
const PATRONYMIC = /(?:ович|евич|ьич|ич|овна|евна|ична|инична)$/u;
const INITIALS = /^[А-ЯЁ]\.(?:\s?[А-ЯЁ]\.)?$/u;
const ENTREPRENEUR = /^(?:ИП|Индивидуальный предприниматель)\s+[А-ЯЁ]/u;

function isPatronymic(token: string | undefined): boolean {
  return token !== undefined && NAME_PART.test(token) && PATRONYMIC.test(token);
}

export function looksLikePersonName(raw: string): boolean {
  const name = raw.trim().replace(/\s+/gu, ' ');
  if (ENTREPRENEUR.test(name)) return true;

  const tokens = name.split(' ');
  if (tokens.length === 2 && NAME_PART.test(tokens[0]!) && INITIALS.test(tokens[1]!)) return true;
  if (
    tokens.length === 3 &&
    NAME_PART.test(tokens[0]!) &&
    INITIALS.test(`${tokens[1]} ${tokens[2]}`)
  ) {
    return true;
  }
  if (!tokens.every((token) => NAME_PART.test(token))) return false;
  // «Имя Отчество», «Фамилия Имя Отчество», «Имя Отчество Фамилия».
  if (tokens.length === 2) return isPatronymic(tokens[1]);
  if (tokens.length === 3) return isPatronymic(tokens[2]) || isPatronymic(tokens[1]);
  return false;
}

/** Имя работодателя, которое разрешено показать в публичном каталоге. */
export function publicEmployerName(company: string, employerIsPerson?: boolean): string {
  return employerIsPerson === true || looksLikePersonName(company) ? PRIVATE_EMPLOYER : company;
}
