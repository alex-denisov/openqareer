import type { ConnectionCirclePath } from './vacancyLetterApi';

const CAPITALIZED = /^\p{Lu}/u;

/**
 * «Мария Крылова» → «Мария К.», как в макете 9. Сокращается только то, что похоже на имя человека:
 * два слова и больше, оба с заглавной. «Команда найма» и одно имя остаются как есть.
 */
export function shortPersonName(fullName: string): string {
  const words = fullName.trim().split(/\s+/u).filter(Boolean);
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last || words.length < 2) return words.join(' ');
  if (!CAPITALIZED.test(first) || !CAPITALIZED.test(last)) return words.join(' ');
  return `${first} ${last.charAt(0)}.`;
}

/**
 * Цепочка Круга 2 от первого посредника до получателя: «Мария К. → Ирина С.».
 * Сервер всегда ставит кандидата первым (`buildConnectionCircles`), а макет 9 его не показывает.
 */
export function personChain(path: ConnectionCirclePath): string {
  const intermediaries = path.path.slice(1);
  const people =
    intermediaries.at(-1)?.id === path.recipient.id
      ? intermediaries
      : [...intermediaries, path.recipient];
  return people
    .map((person) => shortPersonName(person.fullName))
    .filter(Boolean)
    .join(' → ');
}
