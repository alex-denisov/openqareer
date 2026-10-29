import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSkillConfirmations, type SkillConfirmation } from '../skills/skillConfirmationApi';

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

/** Per-skill confirmation data of the signed-in candidate; null skills while unknown. */
export function useSkillConfirmations(candidateId: string) {
  const [skills, setSkills] = useState<readonly SkillConfirmation[] | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getSkillConfirmations(controller.signal).then(
      (data) => setSkills(data.skills),
      () => {
        if (!controller.signal.aborted) setSkills(null);
      },
    );
    return () => controller.abort();
  }, [candidateId, revision]);
  const byName = useMemo(
    () => new Map((skills ?? []).map((item) => [keyOf(item.name), item])),
    [skills],
  );
  const confirmationOf = useCallback(
    (name: string): SkillConfirmation | undefined => byName.get(keyOf(name)),
    [byName],
  );
  const reload = useCallback(() => setRevision((current) => current + 1), []);
  return { skills, confirmationOf, reload };
}
