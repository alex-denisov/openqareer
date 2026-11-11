/**
 * CIO и «ИТ-директор» равны по смыслу (владелец 04.11): одна функция `it-ops` и уровень C-level.
 * Туда же начальник и руководитель ИТ-департамента. Заместитель и помощник — не первое лицо.
 * Хвост — только о месте работы («ИТ-директор группы компаний»): «Директор по ИТ продажам»,
 * «Директор IT-колледжа» и «Операционный директор ИТ» — другие роли. «IT Director» и «Director of IT» — тоже CIO
 * (владелец 04.11); «Head of IT», «Руководитель отдела ИТ» и «Director of IT Operations» — ступень head.
 */
const DEPUTY =
  /(?<!\p{L})(?:deputy|assistant|associate|зам\.?|заместител\p{L}*|помощник\p{L}*)(?!\p{L})/iu;

const OTHER_DIRECTOR =
  /(?<!\p{L})(?:операционн|финансов|генеральн|коммерческ|исполнительн)\p{L}*\s+$/iu;

const IT = '(?:ит|it)';

const NAME_WITH_TAIL = new RegExp(
  `(?<![\\p{L}-])(?:${IT}[- ]директор|it[- ]director|director of (?:it|information technology)|директор по (?:${IT}|информационным технологиям)` +
    `|(?:начальник|руководитель|директор) (?:${IT}[- ]департамента|департамента (?:${IT}|информационных технологий)))(?:\\s*$|\\s+(?:в|на|и|группы|холдинга|компании|дивизиона|завода|банка|at)(?!\\p{L})|\\s*[(.])`,
  'iu',
);

const WHOLE_NAME = new RegExp(`^директор ${IT}$`, 'iu');

/** Такое же название внутри составного: «CTO / ИТ-директор», «Директор ИТ / Руководитель проектов». */
function alternatives(title: string): string[] {
  return title.split(/\s*[/|,]\s*|\s[–—-]\s/u).map((part) => part.trim());
}

function nameWithTail(part: string): boolean {
  const match = NAME_WITH_TAIL.exec(part);
  return match !== null && !OTHER_DIRECTOR.test(part.slice(0, match.index));
}

export function isChiefInformationTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || DEPUTY.test(trimmed)) return false;
  return alternatives(trimmed).some((part) => nameWithTail(part) || WHOLE_NAME.test(part));
}
