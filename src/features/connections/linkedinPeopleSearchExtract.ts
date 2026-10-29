import { parseFragment, textOf } from './linkedinDom';

/**
 * Reads LinkedIn's people search filtered to the candidate's 1st circle
 * (B561, capture of 29.10). With a company name as the keyword, each card's
 * `SearchResultssnippet_` block says `Current: <role> at <Company>`: the
 * person's current place from their experience, which most headlines lack.
 */
export interface LinkedInSearchPerson {
  readonly fullName: string;
  readonly linkedinUrl: string;
  readonly roleTitle: string;
  readonly companyName: string;
}

export interface LinkedInPeopleSearchPage {
  /** Result cards on the page, with or without a current place. */
  readonly cards: number;
  readonly people: readonly LinkedInSearchPerson[];
}

const SEARCH_URL = 'https://www.linkedin.com/search/results/people/';
const SNIPPET_SELECTOR = '[componentkey^="SearchResultssnippet_"]';
const PROFILE_PATH = /^\/in\/([^/?#]+)\/?$/u;
const CURRENT_LINE = /^Current:\s*(.+)$/u;
// "Role at Company"; the last separator wins, company names rarely hold " at ".
const AT_SEPARATOR = /\s+at\s+/gu;
// The degree mark beside the name: only the candidate's own connections count,
// even if LinkedIn ever drops the `network` filter (security review, 29.10).
const FIRST_DEGREE = /•\s*(?:1st|1-й)/u;

export function linkedinPeopleSearchUrl(companyName: string, page: number): string {
  const query = new URLSearchParams({ keywords: companyName, network: '["F"]' });
  if (page > 1) query.set('page', String(page));
  return `${SEARCH_URL}?${query.toString()}`;
}

export function extractLinkedInPeopleSearch(html: string): LinkedInPeopleSearchPage {
  const document = parseFragment(html);
  const snippets = Array.from(document.querySelectorAll(SNIPPET_SELECTOR));
  const seen = new Set<string>();
  const people = snippets.flatMap((snippet) => {
    const person = personOf(snippet);
    if (!person || seen.has(person.linkedinUrl)) return [];
    seen.add(person.linkedinUrl);
    return [person];
  });
  return { cards: snippets.length, people };
}

function personOf(snippet: Element): LinkedInSearchPerson | undefined {
  const place = currentPlace(textOf(snippet) ?? '');
  const nameLink = nameLinkOf(snippet);
  if (!FIRST_DEGREE.test(textOf(nameLink?.closest('p')) ?? '')) return undefined;
  const slug = profileSlug(nameLink?.getAttribute('href'));
  const fullName = textOf(nameLink)?.slice(0, 120);
  if (!place || !slug || !fullName) return undefined;
  return { fullName, linkedinUrl: `https://www.linkedin.com/in/${slug}/`, ...place };
}

/**
 * The card's own name paragraph: the first `p[componentkey]` that holds a
 * profile link before the snippet. Links after it belong to mutual
 * connections, so only the first named link of that paragraph is the person.
 * The card is one link wrapping the name link; re-parsing that nesting
 * leaves empty copies of the outer link in front of the name, hence "named".
 */
function nameLinkOf(snippet: Element): Element | undefined {
  for (let card = snippet.parentElement; card; card = card.parentElement) {
    const link = Array.from(card.querySelectorAll('p[componentkey]'))
      .filter(
        (paragraph) =>
          paragraph.compareDocumentPosition(snippet) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
      .map((paragraph) =>
        Array.from(paragraph.querySelectorAll('a[href]')).find((anchor) => textOf(anchor)),
      )
      .find(Boolean);
    if (link) return link;
  }
  return undefined;
}

function currentPlace(
  line: string,
): { readonly roleTitle: string; readonly companyName: string } | undefined {
  const current = CURRENT_LINE.exec(line)?.[1];
  if (!current) return undefined;
  const last = Array.from(current.matchAll(AT_SEPARATOR)).at(-1);
  if (!last || last.index === undefined) return undefined;
  const roleTitle = current.slice(0, last.index).trim();
  const companyName = current.slice(last.index + last[0].length).trim();
  if (!companyName) return undefined;
  return { roleTitle: roleTitle.slice(0, 160), companyName: companyName.slice(0, 180) };
}

function profileSlug(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, 'https://www.linkedin.com');
    if (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com')) {
      return undefined;
    }
    return PROFILE_PATH.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
}
