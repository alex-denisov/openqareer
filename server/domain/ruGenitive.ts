/**
 * B697: родительный падеж русского ФИО для подписи «знакомы через …». Правила простые
 * (имена и фамилии на -ов/-ев/-ин/-ский и частые окончания); слово, которое правила не
 * знают, остаётся как есть, поэтому латиница и редкие фамилии не искажаются.
 */
const MALE_A_NAMES = new Set(['никита', 'илья', 'лука', 'фома', 'кузьма', 'савва', 'данила', 'гаврила']);
const CYRILLIC = /^[а-яё-]+$/iu;
const SURNAME_SUFFIX = /(ов|ев|ёв|ин|ын)$/u;

type Gender = 'male' | 'female';

function genderOf(parts: readonly string[]): Gender {
  const first = parts[0]?.toLowerCase() ?? '';
  const last = parts[parts.length - 1]?.toLowerCase() ?? '';
  if (/(ова|ева|ёва|ина|ына|ская|цкая|ая)$/u.test(last)) return 'female';
  if (MALE_A_NAMES.has(first)) return 'male';
  return /[ая]$/u.test(first) && !SURNAME_SUFFIX.test(last) ? 'female' : 'male';
}

function maleGenitive(word: string, isGivenName: boolean): string {
  const lower = word.toLowerCase();
  if (isGivenName && /ий$/u.test(lower)) return `${word.slice(0, -1)}я`;
  if (/(ский|цкий|ской)$/u.test(lower)) return `${word.slice(0, -2)}ого`;
  if (/(ий|ый)$/u.test(lower)) return `${word.slice(0, -2)}ого`;
  if (/[йь]$/u.test(lower)) return `${word.slice(0, -1)}я`;
  if (/[ая]$/u.test(lower)) return MALE_A_NAMES.has(lower) ? `${word.slice(0, -1)}${lower.endsWith('а') ? 'ы' : 'и'}` : word;
  if (/[бвгджзклмнпрстфхцчшщ]$/u.test(lower)) return `${word}а`;
  return word;
}

function femaleGenitive(word: string): string {
  const lower = word.toLowerCase();
  if (/(ская|цкая|ая)$/u.test(lower)) return `${word.slice(0, -2)}ой`;
  if (/(ова|ева|ёва|ина|ына)$/u.test(lower)) return `${word.slice(0, -1)}ой`;
  if (/[гкхжчшщ]а$/u.test(lower)) return `${word.slice(0, -1)}и`;
  if (/а$/u.test(lower)) return `${word.slice(0, -1)}ы`;
  if (/ия$/u.test(lower)) return `${word.slice(0, -1)}и`;
  if (/я$/u.test(lower)) return `${word.slice(0, -1)}и`;
  return word;
}

export function genitiveFullName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u);
  if (!parts.every((part) => CYRILLIC.test(part))) return fullName.trim();
  const gender = genderOf(parts);
  return parts.map((part, index) => (gender === 'male' ? maleGenitive(part, index === 0) : femaleGenitive(part))).join(' ');
}
