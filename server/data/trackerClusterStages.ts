import type { ApplicationStage } from '../../shared/applicationStage';
import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import {
  createApplicationTrackerMethods,
  type ApplicationTrackerMethods,
} from './sqliteCandidateStoreApplicationMethods';
import type { ApplicationTrackerController } from './store/applicationTrackerController';

/** Пара «вакансия — этап карточки трекера». */
export interface TrackerClusterStage {
  readonly clusterId: string;
  readonly stage: ApplicationStage;
}

/**
 * B675: чтение карточек трекера для разбора «Помочь выбрать». Только чтение: один SELECT по
 * кандидату, без ленивого переноса откликов, который делает `listApplications`.
 */
export interface TrackerClusterStagesReader {
  listTrackerClusterStages(candidateId: string): TrackerClusterStage[];
}

// Метод объявлен здесь, а не в файлах хранилища: они стоят у предела длины файла.
declare module './candidateStore' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface CandidateStore extends TrackerClusterStagesReader {}
}
declare module './sqliteCandidateStore' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SqliteCandidateStore extends TrackerClusterStagesReader {}
}

/** Методы трекера хранилища вместе с чтением этапов карточек. */
export function createTrackerMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: (candidateId: string) => void,
  database: DatabaseSync,
  sealedText: SealedText,
): ApplicationTrackerMethods & TrackerClusterStagesReader {
  return {
    ...createApplicationTrackerMethods(tracker, requireCandidate, database, sealedText),
    listTrackerClusterStages(candidateId) {
      requireCandidate(candidateId);
      return tracker.listClusterStages(candidateId);
    },
  };
}
