export type FootprintMatch = 'confirmed_self' | 'likely_self' | 'unknown' | 'not_self';

export interface FootprintFinding {
  readonly adapter: string; // "sherlock", "exiftool", …
  readonly kind: string; // "profile", "breach", "metadata", "secret", "archive", "mention"
  readonly url: string | null;
  readonly title: string;
  readonly detail: string; // без секретов и без чужих персональных данных
  readonly match: FootprintMatch; // адаптер ставит максимум likely_self; confirmed_self — только кандидат
  readonly observedAt: string; // ISO
  readonly receipt: { readonly method: string; readonly source: string; readonly query: string };
}

export interface FootprintAdapter<I> {
  readonly id: string;
  readonly passive: true; // активных проверок нет
  run(input: I, signal: AbortSignal): Promise<readonly FootprintFinding[]>;
}

export type FootprintSourceFailure = 'not_connected' | 'source_error';

export class FootprintSourceError extends Error {
  readonly name = 'FootprintSourceError';

  constructor(
    readonly sourceId: string,
    readonly failure: FootprintSourceFailure,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }

  get source(): string {
    return this.sourceId;
  }
}
