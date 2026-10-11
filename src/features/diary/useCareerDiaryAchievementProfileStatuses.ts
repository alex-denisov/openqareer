import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CareerDiaryAchievement } from '../../../shared/careerDiary';
import { getCareerCommands } from '../coach/careerCommandApi';
import type { CareerCommand } from '../coach/coachApi';
import { careerDiaryAchievementProfileStatus, type CareerDiaryAchievementProfileStatus } from './careerDiaryAchievementProfile';

export function useCareerDiaryAchievementProfileStatuses(
  enabled: boolean,
  achievements: readonly CareerDiaryAchievement[],
) {
  const [commands, setCommands] = useState<CareerCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getCareerCommands()
      .then((items) => {
        if (!controller.signal.aborted) setCommands([...items]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Не удалось проверить профильные предложения.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, revision]);

  const statuses = useMemo<ReadonlyMap<string, CareerDiaryAchievementProfileStatus>>(
    () => new Map(achievements.map((achievement) => [
      achievement.id,
      careerDiaryAchievementProfileStatus(achievement.id, commands),
    ])),
    [achievements, commands],
  );

  return { statuses, loading, error, reload };
}
