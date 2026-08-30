/**
 * Relevance for a vacancy query.
 *
 * The previous ranker asked `searchable.includes(term)`, so a two-letter term
 * matched inside any longer word: `go` hit *Django*, *Google* and *Algolia*,
 * `qa` hit *Aqua Security*. It also scored a six-word query the same way as a
 * one-word query, so a single stray word in `location` was enough to pass
 * anything (B161 review §4, carried into B164).
 *
 * The rules now are: terms match on word boundaries, the title weighs more
 * than the company or the location, and a longer query has to be matched in
 * real part before an item counts as an answer to it.
 */
export interface RankableVacancy {
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly requirements?: readonly string[];
}

/** How much of a query an item has to match before it counts as an answer. */
const MINIMUM_MATCH_SHARE = 0.5;

const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

function queryTerms(query: string): string[] {
  return query
    .toLocaleLowerCase('en')
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((term) => term.length > 0);
}

/**
 * Word-boundary containment that keeps `+` and `#` — `c++` and `c#` are the
 * names of the skills, and a generic `\b` drops them.
 */
function containsTerm(haystack: string, term: string): boolean {
  let index = haystack.indexOf(term);
  while (index !== -1) {
    const before = haystack[index - 1];
    const after = haystack[index + term.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    index = haystack.indexOf(term, index + 1);
  }
  return false;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

export function rankVacanciesByQuery<T extends RankableVacancy>(
  items: readonly T[],
  query: string,
): T[] {
  const terms = queryTerms(query);
  // No usable term means no relevance signal. Returning the raw snapshot here
  // would label unfiltered feed content as an answer to the query (B161).
  if (terms.length === 0) return [];
  const required = Math.max(1, Math.ceil(terms.length * MINIMUM_MATCH_SHARE));

  return items
    .map((item, index) => {
      const title = item.title.toLocaleLowerCase('en');
      const body = [item.company, item.location ?? '', ...(item.requirements ?? [])]
        .join(' ')
        .toLocaleLowerCase('en');
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const inTitle = containsTerm(title, term);
        const inBody = containsTerm(body, term);
        if (!inTitle && !inBody) continue;
        matched += 1;
        score += inTitle ? TITLE_WEIGHT : BODY_WEIGHT;
      }
      return { item, score, matched, index };
    })
    .filter((scored) => scored.matched >= required)
    // A stable order: equal scores keep the corpus order rather than shuffling
    // between two identical requests.
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((scored) => scored.item);
}
