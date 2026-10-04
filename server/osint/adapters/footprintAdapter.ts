export type FootprintMatch = 'confirmed_self' | 'likely_self' | 'unknown' | 'not_self';

export interface FootprintFinding {
  readonly adapter: string;
  readonly kind: string;
  readonly url: string | null;
  readonly title: string;
  readonly detail: string;
  readonly match: FootprintMatch;
  readonly observedAt: string;
  readonly receipt: {
    readonly method: string;
    readonly source: string;
    readonly query: string;
  };
}

export interface FootprintAdapter<I> {
  readonly id: string;
  readonly passive: true;
  run(input: I, signal: AbortSignal): Promise<readonly FootprintFinding[]>;
}

export type FootprintSourceFailure = 'not_connected' | 'source_error';

export class FootprintSourceError extends Error {
  readonly name = 'FootprintSourceError';

  constructor(
    readonly sourceId: string,
    readonly failure: FootprintSourceFailure,
    message: string,
  ) {
    super(message);
  }
}
