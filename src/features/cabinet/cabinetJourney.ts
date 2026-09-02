import {
  buildCanonicalProfileJourney,
  buildCareerJourney,
  type CareerJourney,
} from '../journey/careerJourneyEngine';
import type { CanonicalProfileMemory } from '../diagnostic/careerDiagnostic';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { poolMarketObservations } from '../career-map/marketObservations';

/**
 * Карьерная картина вошедшего кандидата собирается из его фактов на сервере.
 *
 * Оболочка строила её только из браузерной анкеты и в кабинет не передавала, а
 * кабинет ничего своего не строил — поэтому «ATS-читаемость» и «Следующее
 * действие» показывали пустые состояния даже тому, у кого разобрано резюме и
 * подтверждены факты (B103, B105). Анкета остаётся основой, когда она есть;
 * факты сервера дополняют её и работают сами по себе, когда анкеты нет.
 */
export function cabinetJourney({
  workspace,
  memory,
  targetDirection,
  pool,
  now,
}: {
  readonly workspace?: CandidateWorkspace;
  readonly memory: readonly CanonicalProfileMemory[];
  readonly targetDirection: string;
  /** Собранный пул: из него карта ролей берёт наблюдения рынка (B104). */
  readonly pool?: readonly MatchedVacancyItem[];
  readonly now?: string;
}): CareerJourney | undefined {
  // Ни анкеты, ни фактов — картины нет. Пустая карточка честнее выдуманной.
  if (!workspace && memory.length === 0) return undefined;
  const base = workspace ? buildCareerJourney(workspace, now) : undefined;
  if (memory.length === 0) return base;
  return buildCanonicalProfileJourney(
    base,
    [...memory],
    targetDirection,
    now,
    workspace?.constraints ?? '',
    pool ? poolMarketObservations(pool) : undefined,
  );
}
