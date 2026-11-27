/**
 * B741 (прод 22.11): «Go» без учёта регистра находил язык в «go-to-market», «go live» и
 * «go above and beyond». Язык — только отдельное слово с заглавной; «Go-разработчик» — язык,
 * «go-to» и «go-live» — нет. «Golang» — язык в любом регистре.
 */
export const GO_LANGUAGE =
  /(?<![\p{L}\p{N}-])Go(?![\p{L}\p{N}])(?!-(?:[Tt]o|[Ll]ive)\b)(?!\s+(?:live|above|ahead|beyond|to|through|for|with|after|back)\b)/u;

/** «Go» по правилу выше или «Golang» в любом регистре. */
export const GO_OR_GOLANG = new RegExp(
  `${GO_LANGUAGE.source}|(?<![\\p{L}\\p{N}])[Gg]olang(?![\\p{L}\\p{N}])`,
  'u',
);
