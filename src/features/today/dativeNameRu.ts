/** «Напомнить Марии Орловой»: имя и фамилия в дательном падеже для строки очереди. */
const MALE_NAMES_ENDING_IN_A = new Set(['Никита', 'Илья', 'Кузьма', 'Фома', 'Лука', 'Савва']);
const CYRILLIC_WORD = /^[А-ЯЁ][а-яё-]+$/u;

function dativeGivenName(name: string, female: boolean): string {
  if (/ия$/u.test(name)) return `${name.slice(0, -1)}и`;
  if (/[ая]$/u.test(name)) return `${name.slice(0, -1)}е`;
  if (female) return name;
  if (/[йь]$/u.test(name)) return `${name.slice(0, -1)}ю`;
  return `${name}у`;
}

function dativeSurname(surname: string, female: boolean): string {
  if (female) {
    if (/(ова|ева|ёва|ина|ына)$/u.test(surname)) return `${surname.slice(0, -1)}ой`;
    if (/(ая|яя)$/u.test(surname)) return `${surname.slice(0, -2)}ой`;
    return surname;
  }
  if (/(ский|цкий|ой|ый|ий)$/u.test(surname)) return `${surname.slice(0, -2)}ому`;
  if (/[бвгджзклмнпрстфхцчшщ]$/u.test(surname)) return `${surname}у`;
  return surname;
}

export function dativeNameRu(fullName: string): string {
  const words = fullName.trim().split(/\s+/u);
  if (words.length !== 2 || !words.every((word) => CYRILLIC_WORD.test(word)))
    return fullName.trim();
  const [given, surname] = words as [string, string];
  const female = /[ая]$/u.test(given) && !MALE_NAMES_ENDING_IN_A.has(given);
  return `${dativeGivenName(given, female)} ${dativeSurname(surname, female)}`;
}
