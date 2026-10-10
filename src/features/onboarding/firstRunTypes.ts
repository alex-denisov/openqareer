export type FirstRunStep = 'goal' | 'source' | 'context';

export type FirstRunSpecialState =
  | 'normal'
  | 'skeleton'
  | 'stale-loading'
  | 'error'
  | 'session-expired'
  | 'empty-sources'
  | 'partial-source';

export type SourceType = 'linkedin' | 'hh' | 'file' | 'talk';

export interface FirstRunCity {
  readonly name: string;
  readonly country: string;
}

export type WorkFormat = 'Гибрид' | 'Удалённо' | 'Офис';

export interface FirstRunContext {
  readonly city: string;
  readonly country: string;
  readonly format: WorkFormat;
  readonly isRelocationReady: boolean;
}

export interface FirstRunData {
  readonly goal: string;
  readonly selectedSource: SourceType | null;
  readonly isSourceSkipped: boolean;
  readonly context: FirstRunContext;
}

export interface ConsultantTurn {
  readonly id: string;
  readonly text: string;
  readonly isUser: boolean;
}

export const POPULAR_CITIES: readonly FirstRunCity[] = [
  { name: 'Москва', country: 'Россия' },
  { name: 'Санкт-Петербург', country: 'Россия' },
  { name: 'Новосибирск', country: 'Россия' },
  { name: 'Екатеринбург', country: 'Россия' },
  { name: 'Казань', country: 'Россия' },
  { name: 'Ереван', country: 'Армения' },
  { name: 'Белград', country: 'Сербия' },
];

export const DEFAULT_FIRST_RUN_DATA: FirstRunData = {
  goal: 'Хочу понять, на какие руководящие роли могу идти. Ищу активно.',
  selectedSource: 'linkedin',
  isSourceSkipped: false,
  context: {
    city: 'Москва',
    country: 'Россия',
    format: 'Гибрид',
    isRelocationReady: false,
  },
};
