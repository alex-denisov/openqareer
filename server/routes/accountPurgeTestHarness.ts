import { DatabaseSync } from 'node:sqlite';
import { AuthService } from '../auth/authService';
import { TwoFactorStore } from '../auth/twoFactorStore';
import { SealedText } from '../data/sealedText';
import type { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { SqliteDiaryCheckpointRepository } from '../data/sqliteDiaryCheckpointRepository';
import { SqliteDiaryDetailsRepository } from '../data/sqliteDiaryDetailsRepository';
import { SqliteDiaryPeopleRepository } from '../data/sqliteDiaryPeopleRepository';
import { SqliteKpiImportRepository } from '../data/sqliteKpiImportRepository';
import { SqliteTelegramUsernameStore } from '../notifications/telegramUsernameStore';
import { HH_TEXT_PRIORITY_TABLE } from '../vacancies/hhTextPriorityTable';
import { SqliteInterviewRecordingRepository } from '../data/sqliteInterviewRecordingRepository';

/**
 * B739: таблицы, которые создаются не при сборке приложения, а лениво (первый запрос
 * маршрута), настоящей службой входа или хранилищем пула. Тест удаления аккаунта открывает
 * их сам, чтобы проверить удаление на настоящей схеме. Новая такая таблица без строки здесь
 * роняет тест «в базе приложения есть каждая таблица с владельцем».
 */
export function openSideTablesForPurgeTest(
  databasePath: string,
  encryptionKey: Buffer,
  store: SqliteCandidateStore,
): void {
  const options = { databasePath, encryptionKey };
  new AuthService({ databasePath }).close();
  new TwoFactorStore(options).close();
  new SqliteDiaryDetailsRepository(options).close();
  new SqliteDiaryCheckpointRepository(options).close();
  new SqliteDiaryPeopleRepository(options).close();
  new SqliteKpiImportRepository(options).close();
  // B642: таблицы записей интервью создаются при первом обращении к записи.
  new SqliteInterviewRecordingRepository({ databasePath }).close();
  const telegram = new DatabaseSync(databasePath);
  new SqliteTelegramUsernameStore(telegram, new SealedText(encryptionKey));
  telegram.exec(HH_TEXT_PRIORITY_TABLE);
  telegram.close();
  // Таблицу возобновлений разговора хранилище создаёт только при первом возобновлении.
  (
    store as unknown as { consultantHistory: { ensureResumeTable(): void } }
  ).consultantHistory.ensureResumeTable();
}
