const FALLBACK = 'Написать знакомому';
const IRREGULAR: Readonly<Record<string, string>> = { павел: 'Павлу', лев: 'Льву', пётр: 'Петру', петр: 'Петру' };
const CONSONANT = /[бвгджзклмнпрстфхцчшщ]$/i;

/** Имя в дательном падеже; нет уверенной формы — undefined. */
function dative(first: string): string | undefined {
  const irregular = IRREGULAR[first.toLocaleLowerCase('ru-RU')];
  if (irregular) return irregular;
  if (/ия$/i.test(first)) return `${first.slice(0, -1)}и`;
  if (/[ая]$/i.test(first)) return `${first.slice(0, -1)}е`;
  if (/й$/i.test(first)) return `${first.slice(0, -1)}ю`;
  return CONSONANT.test(first) ? `${first}у` : undefined;
}

/** «Написать Роману» — главное действие шапки карточки; латиницу не склоняем; без уверенного падежа — «знакомому». */
export function writeToLabel(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  if (/^[A-Za-z][A-Za-z'-]*$/.test(first)) return `Написать ${first}`;
  const form = /^[А-ЯЁа-яё-]+$/.test(first) ? dative(first) : undefined;
  return form ? `Написать ${form}` : FALLBACK;
}
