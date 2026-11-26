import { useEffect, useState } from 'react';
import { getResumeStudio } from '../../resume/resumeApi';
import { getOverview } from './diaryApi';

/** Роль для вопроса о целях: должность на новом месте, иначе целевая роль профиля. */
export async function loadRoleTitle(): Promise<string | null> {
  const workplace = await getOverview().then(
    (overview) => overview.primaryWorkplace?.title.trim() || null,
    () => null,
  );
  if (workplace) return workplace;
  return getResumeStudio().then(
    (studio) => studio.projection.master?.targetRole?.trim() || null,
    () => null,
  );
}

/** `undefined` — ещё читаем; `null` — роли нет. */
export function useRoleTitle(): string | null | undefined {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadRoleTitle().then((value) => active && setRole(value));
    return () => {
      active = false;
    };
  }, []);
  return role;
}
