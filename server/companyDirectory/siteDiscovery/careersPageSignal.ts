/**
 * B643: a careers candidate is kept only if the page itself says it is about
 * vacancies. Hand-checked prod misses: a product page, a 404 page served with
 * HTTP 200, a news article, a job-board product page.
 */
import { boardsFromHtml } from './atsBoards';

export type CareersPageVerdict = 'ok' | 'no_vacancy_signal' | 'not_found_page';

/** Words a vacancies page puts in its title or headings; whole words only. */
const HEADING_WORD =
  /\b(careers?|jobs?|vacanc(?:y|ies)|join (?:our|the) team|join us|work with us|open (?:positions|roles)|we'?re hiring|karriere|stellen(?:angebote)?|emplois?|carri[eè]res?)\b|(?:^|[^а-яё])(карьера|вакансии|вакансия|работа у нас|работа в|присоединяйтесь|открытые позиции)(?:$|[^а-яё])/iu;
const NOT_FOUND = /\b404\b|not found|page (?:does not|doesn't) exist|nicht gefunden|страница не найдена|не найдена|ошибка 404/iu;
const HEADINGS = /<(title|h1|h2)\b[^>]*>([\s\S]{0,300}?)<\/\1>/gi;

function headingTexts(html: string): readonly string[] {
  return [...html.matchAll(HEADINGS)].map(([, , text = '']) => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Pure: verdict on the page HTML; a 404 look wins over any vacancy word. */
export function careersPageVerdict(html: string): CareersPageVerdict {
  const texts = headingTexts(html);
  const firstHeadings = texts.slice(0, 3);
  if (firstHeadings.some((text) => NOT_FOUND.test(text))) return 'not_found_page';
  if (texts.some((text) => HEADING_WORD.test(text))) return 'ok';
  return boardsFromHtml(html).length > 0 ? 'ok' : 'no_vacancy_signal';
}
