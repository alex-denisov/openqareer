import type { CandidateFootprintAdapterStatus } from './candidateFootprint';

/**
 * B740: шаги проверки цифрового следа, как их видит клиент. Названия инструментов и
 * способов поиска остаются на сервере (решение владельца об OSINT): клиент, выгрузка
 * и любой ответ API знают только нейтральный код шага и его русское название.
 */
export type FootprintStep =
  | 'nickname'
  | 'nickname_extended'
  | 'leaks'
  | 'archive'
  | 'web'
  | 'video'
  | 'files'
  | 'code'
  | 'other';

/** Порядок строк «Что проверяем» на прежнем экране. */
export const FOOTPRINT_STEPS: readonly FootprintStep[] = [
  'nickname',
  'nickname_extended',
  'leaks',
  'archive',
  'web',
];

export const FOOTPRINT_STEP_LABELS: Readonly<Record<FootprintStep, string>> = {
  nickname: 'Профили по никнейму',
  nickname_extended: 'Профили по никнейму: расширенная проверка',
  leaks: 'Утечки почты',
  archive: 'Старые версии страниц',
  web: 'Упоминания в открытом вебе',
  video: 'Канал YouTube',
  files: 'Метаданные файлов',
  code: 'Секреты в коде',
  other: 'Другие проверки',
};

/** Состояние шага, как его отдаёт сервер: код шага вместо инструмента. */
export type FootprintStepStatus = Omit<CandidateFootprintAdapterStatus, 'adapterId'> & {
  readonly adapterId: FootprintStep;
};
