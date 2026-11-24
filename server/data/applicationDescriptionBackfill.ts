import type { DatabaseSync } from 'node:sqlite';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';
import type { SealedText } from './sealedText';
import { vacancyAssociatedData } from './sqliteApplicationRepository';

export interface DescriptionBackfillResult {
  readonly checked: number;
  readonly filled: number;
  readonly failed: number;
}

interface StoredSnapshotRow {
  readonly id: string;
  readonly candidate_id: string;
  readonly cluster_id: string;
  readonly vacancy_cipher: string;
}

type EnrichSnapshot = (
  clusterId: string,
  snapshot: VacancyApplicationSnapshot,
) => VacancyApplicationSnapshot | undefined;

/**
 * B635: догон описания вакансии у откликов, созданных без него, пока вакансия ещё в пуле.
 * По одному отклику с паузой, чтобы не держать цикл событий. Меняется только снимок: версия
 * и время отклика прежние. Повтор безопасен — заполненные снимки пропускаются.
 */
export async function backfillApplicationDescriptions(input: {
  readonly database: DatabaseSync;
  readonly sealedText: SealedText;
  readonly enrich: EnrichSnapshot;
  readonly pause: () => Promise<void>;
}): Promise<DescriptionBackfillResult> {
  const ids = input.database
    .prepare(
      'SELECT id FROM applications WHERE cluster_id IS NOT NULL AND vacancy_cipher IS NOT NULL',
    )
    .all() as unknown as { id: string }[];
  let filled = 0;
  let failed = 0;
  for (const { id } of ids) {
    try {
      if (fillOne(input, id)) filled += 1;
    } catch {
      // Битый или чужим ключом запечатанный снимок не останавливает догон остальных.
      failed += 1;
    }
    await input.pause();
  }
  return { checked: ids.length, filled, failed };
}

function fillOne(
  input: {
    readonly database: DatabaseSync;
    readonly sealedText: SealedText;
    readonly enrich: EnrichSnapshot;
  },
  id: string,
): boolean {
  const row = input.database
    .prepare(
      `SELECT id, candidate_id, cluster_id, vacancy_cipher FROM applications
       WHERE id = ? AND cluster_id IS NOT NULL AND vacancy_cipher IS NOT NULL`,
    )
    .get(id) as StoredSnapshotRow | undefined;
  if (!row) return false;
  const associatedData = vacancyAssociatedData(row.candidate_id, row.id);
  const snapshot = JSON.parse(
    input.sealedText.open(row.vacancy_cipher, associatedData),
  ) as VacancyApplicationSnapshot;
  if (snapshot.description?.trim()) return false;
  const enriched = input.enrich(row.cluster_id, snapshot);
  if (!enriched?.description?.trim()) return false;
  // Второй слот мог записать снимок между чтением и записью: тогда строка уже не та.
  const result = input.database
    .prepare('UPDATE applications SET vacancy_cipher = ? WHERE id = ? AND vacancy_cipher = ?')
    .run(
      input.sealedText.seal(JSON.stringify(enriched), associatedData),
      row.id,
      row.vacancy_cipher,
    );
  return Number(result.changes) > 0;
}
