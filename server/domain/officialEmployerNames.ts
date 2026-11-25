interface OfficialName {
  /** Название во всех падежах, с сокращением в скобках или без него. */
  readonly pattern: RegExp;
  readonly name: string;
}

const OFFICIAL: readonly OfficialName[] = [
  {
    pattern:
      /(?<!\p{L})корпоративн(?:ый|ого|ому|ым|ом)\s+университет(?:а|у|ом|е)?\s+сбербанка(?!\p{L})(?:\s*\(\s*[«"]?сбер\s?университет(?:а|у|ом|е)?[»"]?\s*\))?/giu,
    name: 'Corporate University of Sberbank (SberUniversity)',
  },
];

/** Официальные английские названия: они важнее написания кандидата и транслитерации. */
export function withOfficialNames(text: string): string {
  return OFFICIAL.reduce((result, { pattern, name }) => result.replace(pattern, name), text);
}

/** Официальное название, если `employer` целиком — известный работодатель. */
export function officialName(employer: string): string | undefined {
  return OFFICIAL.find(({ pattern }) => employer.trim().replace(pattern, '') === '')?.name;
}
