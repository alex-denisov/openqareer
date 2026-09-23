import { useEffect, useState } from 'react';
import { getMatchedVacancyPage } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { collectMatchedPool, withDeadline } from './vacancyRead';

export interface MatchedPool {
  readonly matched: MatchedVacancyItem[];
  readonly total: number;
  readonly poolTotal: number;
  readonly loading: boolean;
  readonly failed: boolean;
  /** Прочитан ли пул целиком: выборка по половине пула — не выборка по пулу. */
  readonly complete: boolean;
  /** Кампания и гипотезы роли — только с первой страницы (B248). */
  readonly campaign?: CampaignMetaView;
  /** Целевой уровень кандидата, выведенный сервером — только с первой страницы. */
  readonly candidateLevel?: string | null;
}

/**
 * Один прочитанный пул на весь кабинет.
 *
 * Подбор приходит полусотней страниц, и каждый экран, читавший его сам,
 * повторял эти полсотни запросов. Кабинет читает пул один раз и передаёт его
 * вниз; переданный пул экран не перечитывает (B104).
 */
export function useMatchedPool(provided?: MatchedPool): MatchedPool {

  const [matched, setMatched] = useState<MatchedVacancyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [poolTotal, setPoolTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [complete, setComplete] = useState(false);
  const [campaign, setCampaign] = useState<CampaignMetaView | undefined>(undefined);
  const [candidateLevel, setCandidateLevel] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (provided) return;
    let active = true;
    void collectMatchedPool<MatchedVacancyItem>(
      (offset) =>
        withDeadline((signal) => getMatchedVacancyPage(offset, signal)).then((page) => {
          // Кампания едет только с первой страницей (B211, тот же приём).
          if (offset === 0 && active) {
            if (page.campaign) setCampaign(page.campaign);
            if (page.candidateLevel !== undefined) setCandidateLevel(page.candidateLevel);
          }
          return page;
        }),
      undefined,
      // Пул приходит полусотней страниц. Экран показывает каждую сразу: ждать
      // последнюю — это десяток секунд «Читаем пул…» вместо вакансий.
      (items, poolSize) => {
        if (!active) return;
        setMatched((read) => [...read, ...items]);
        setPoolTotal(poolSize);
        setLoading(false);
      },
    )
      .then((pool) => {
        if (!active) return;
        // Прочитано меньше, чем есть в подборе, — счётчик показывает
        // прочитанное, а не заявленное: иначе экран пообещал бы записи,
        // которых на нём нет.
        setTotal(pool.complete ? pool.total : pool.items.length);
        setComplete(pool.complete);
      })
      .catch(() => {
        // Не прочитали — это не «пусто»: молчание делает недоступный источник
        // неотличимым от честно пустого пула. Истёкшее ожидание попадает сюда
        // же: подбор, который не ответил за отведённое время, не ответил.
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provided]);

  return (
    provided ?? { matched, total, poolTotal, loading, failed, complete, campaign, candidateLevel }
  );
}
