export type WayAction =
  | { readonly kind: 'letter'; readonly label: string }
  | { readonly kind: 'external'; readonly label: string; readonly url: string };

export interface ApplyWay {
  readonly id: 'hh' | 'site' | 'direct';
  readonly title: string;
  readonly action: WayAction;
}

export interface WaysInput {
  readonly sources: readonly { readonly sourceType: string; readonly sourceUrl: string }[];
  readonly primaryUrl: string;
  readonly recruiterName: string | undefined;
}

function safeUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function isHhHost(url: URL): boolean {
  return url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru');
}

function siteUrl(input: WaysInput): string | undefined {
  const candidates = [...input.sources.filter((source) => source.sourceType !== 'hh').map((source) => source.sourceUrl), input.primaryUrl];
  for (const candidate of candidates) {
    const url = safeUrl(candidate);
    if (url && !isHhHost(url)) return url.toString();
  }
  return undefined;
}

/** Способы отклика — только те, что известны по вакансии. Первый — выбранный по умолчанию. */
export function applyWays(input: WaysInput): readonly ApplyWay[] {
  const hasHh = input.sources.some((source) => source.sourceType === 'hh');
  const site = siteUrl(input);
  return [
    ...(hasHh
      ? [{ id: 'hh', title: 'hh.ru — письмо и ваше резюме', action: { kind: 'letter', label: 'Откликнуться на hh.ru' } } as const]
      : []),
    ...(site
      ? [{ id: 'site', title: 'Сайт компании', action: { kind: 'external', label: 'Открыть на сайте работодателя', url: site } } as const]
      : []),
    ...(input.recruiterName
      ? [{ id: 'direct', title: `Напрямую рекрутёру — ${input.recruiterName}`, action: { kind: 'letter', label: 'Откликнуться напрямую' } } as const]
      : []),
  ];
}
